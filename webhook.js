// ================================================================
// FILE: api/webhook.js
// PHYSIQUE AI — LemonSqueezy Webhook Handler
// ----------------------------------------------------------------
// LemonSqueezy automatically calls this URL when:
// ✅ Someone pays → activate Pro access
// ✅ Monthly renewal → payment received log
// ✅ Someone cancels → remove Pro access
// ✅ Payment fails → log for follow-up
//
// HOW RECURRING PAYMENTS WORK:
// User pays $12 on Jan 1 → LemonSqueezy auto-charges Feb 1
// → Calls this webhook with "subscription_payment_success"
// → You receive money, user keeps Pro access automatically
// → This repeats every month forever until they cancel
//
// HOW CANCELLATION WORKS:
// User clicks "Manage Subscription" in app
// → Goes to LemonSqueezy portal
// → Clicks Cancel
// → LemonSqueezy calls this webhook with "subscription_cancelled"
// → User keeps access until end of paid period
// → Never charged again
// You do NOTHING — it's all automatic
// ================================================================

import crypto from 'crypto';

const LS_WEBHOOK_SECRET = process.env.LS_WEBHOOK_SECRET;

// Verify the webhook is genuinely from LemonSqueezy
// Prevents hackers from faking payment events
function verifySignature(rawBody, signature) {
  if (!LS_WEBHOOK_SECRET) return false;
  const hash = crypto
    .createHmac('sha256', LS_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

// ── User Management Functions ──────────────────────────────────
// Replace these console.logs with your database calls
// when you add a proper database later (e.g. Supabase)

async function activateProAccess(data) {
  const customerId    = data.attributes?.customer_id;
  const customerEmail = data.attributes?.user_email;
  const customerName  = data.attributes?.user_name;
  const plan          = data.attributes?.product_name || 'Physique Pro';
  const endsAt        = data.attributes?.ends_at;

  console.log(`✅ PRO ACTIVATED`);
  console.log(`   Customer ID: ${customerId}`);
  console.log(`   Email: ${customerEmail}`);
  console.log(`   Name: ${customerName}`);
  console.log(`   Plan: ${plan}`);
  console.log(`   Next renewal: ${endsAt}`);

  // ── TODO: Save to database when you're ready ──
  // Example with Supabase (add later):
  // const { createClient } = require('@supabase/supabase-js')
  // const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  // await supabase.from('users').upsert({
  //   email: customerEmail,
  //   plan: 'pro',
  //   ls_customer_id: customerId,
  //   plan_expires_at: endsAt,
  //   updated_at: new Date().toISOString()
  // }, { onConflict: 'email' })
}

async function deactivateProAccess(data) {
  const customerId    = data.attributes?.customer_id;
  const customerEmail = data.attributes?.user_email;
  const endsAt        = data.attributes?.ends_at;

  console.log(`❌ SUBSCRIPTION CANCELLED`);
  console.log(`   Customer ID: ${customerId}`);
  console.log(`   Email: ${customerEmail}`);
  console.log(`   Access ends: ${endsAt}`);
  console.log(`   User keeps access until above date, then auto-downgraded`);

  // ── TODO: Update database ──
  // await supabase.from('users').update({
  //   plan: 'free',
  //   plan_expires_at: endsAt  // keep access until this date
  // }).eq('email', customerEmail)
}

async function handlePaymentSuccess(data) {
  const amount        = (data.attributes?.total || 0) / 100;
  const customerEmail = data.attributes?.user_email;
  const orderId       = data.attributes?.identifier;

  console.log(`💰 PAYMENT RECEIVED`);
  console.log(`   Amount: $${amount}`);
  console.log(`   Customer: ${customerEmail}`);
  console.log(`   Order: ${orderId}`);
}

async function handlePaymentFailed(data) {
  const customerEmail = data.attributes?.user_email;
  const customerId    = data.attributes?.customer_id;

  console.log(`⚠️ PAYMENT FAILED`);
  console.log(`   Customer: ${customerEmail}`);
  console.log(`   ID: ${customerId}`);
  console.log(`   LemonSqueezy will retry automatically`);
  console.log(`   And email the customer to update their card`);
}

// ── Disable body parser — need raw body for signature check ──
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).end();

  // Read raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Verify signature — reject if not from LemonSqueezy
  const signature = req.headers['x-signature'];
  if (!verifySignature(rawBody, signature)) {
    console.error('❌ Invalid webhook signature — possible attack attempt');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const eventName = req.headers['x-event-name'];
  const data      = event?.data;

  console.log(`📨 Webhook received: ${eventName}`);

  try {
    switch (eventName) {

      // ── New subscription created (first payment) ──
      case 'subscription_created':
        await activateProAccess(data);
        break;

      // ── Subscription renewed (monthly auto-payment) ──
      case 'subscription_payment_success':
        await handlePaymentSuccess(data);
        await activateProAccess(data); // re-confirm active
        break;

      // ── User cancelled subscription ──
      case 'subscription_cancelled':
      case 'subscription_expired':
        await deactivateProAccess(data);
        break;

      // ── Payment failed (card declined etc.) ──
      case 'subscription_payment_failed':
        await handlePaymentFailed(data);
        // LemonSqueezy automatically:
        // 1. Retries payment 3 times
        // 2. Emails customer to update card
        // 3. Cancels if all retries fail
        // You don't need to do anything
        break;

      // ── Subscription updated (plan change) ──
      case 'subscription_updated':
        console.log(`🔄 SUBSCRIPTION UPDATED — Customer: ${data?.attributes?.customer_id}`);
        break;

      // ── One-time order (if you add any) ──
      case 'order_created':
        await handlePaymentSuccess(data);
        break;

      default:
        console.log(`ℹ️ Unhandled event: ${eventName}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Processing failed' });
  }
}
