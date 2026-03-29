// ================================================================
// FILE: api/portal.js
// PHYSIQUE AI — LemonSqueezy Subscription Management
// ----------------------------------------------------------------
// When user clicks "Manage Subscription" in Profile tab:
// → This sends them to LemonSqueezy customer portal
// → They can cancel, update payment, view invoices
// → ALL handled by LemonSqueezy automatically
// → You do nothing — it's fully automatic
// ================================================================

const LS_API_KEY = process.env.LS_API_KEY;
const SITE_URL   = process.env.SITE_URL || 'https://physiqueai.app';

function setSecHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
}

export default async function handler(req, res) {
  setSecHeaders(res);

  const allowed = [SITE_URL, SITE_URL.replace('https://', 'https://www.')];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!LS_API_KEY) return res.status(500).json({ error: 'Server configuration error.' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid request.' }); }

  const { customerId } = body || {};
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'Customer ID required.' });
  }

  try {
    // ── Get customer's active subscriptions from LemonSqueezy ──
    const subRes = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions?filter[customer_id]=${encodeURIComponent(customerId)}`,
      {
        headers: {
          'Accept': 'application/vnd.api+json',
          'Authorization': `Bearer ${LS_API_KEY}`,
        },
      }
    );

    if (!subRes.ok) {
      console.error('LemonSqueezy subscription fetch failed:', await subRes.text());
      return res.status(502).json({ error: 'Could not fetch subscription.' });
    }

    const subData = await subRes.json();
    const subscription = subData?.data?.[0];

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found.' });
    }

    // ── Get the customer portal URL from the subscription ──
    // LemonSqueezy includes a portal URL in subscription data
    const portalUrl = subscription?.attributes?.urls?.customer_portal;

    if (portalUrl) {
      return res.status(200).json({ url: portalUrl });
    }

    // ── Fallback: get portal from subscription update URL ──
    const updateUrl = subscription?.attributes?.urls?.update_payment_method;
    if (updateUrl) {
      return res.status(200).json({ url: updateUrl });
    }

    return res.status(404).json({ error: 'Portal URL not found.' });

  } catch (err) {
    console.error('Portal error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
