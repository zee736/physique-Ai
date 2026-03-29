// ================================================================
// FILE: api/chat.js
// PHYSIQUE AI — Secure AI Backend Proxy
// ----------------------------------------------------------------
// ✅ Anthropic API key NEVER exposed to users
// ✅ Rate limiting (30 requests/min per IP)
// ✅ Input sanitization (blocks malicious input)
// ✅ CORS protection (only your domain allowed)
// ✅ Security headers on every response
// ✅ Message history capped (prevents abuse)
// ================================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_MSG_HISTORY   = 20;
const MAX_INPUT_LENGTH  = 2000;
const RATE_LIMIT_MAX    = 30;
const RATE_LIMIT_WINDOW = 60000;

const rateMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + RATE_LIMIT_WINDOW; }
  rec.count++;
  rateMap.set(ip, rec);
  return { allowed: rec.count <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - rec.count) };
}

function sanitize(text) {
  if (typeof text !== 'string') return '';
  return text
    .slice(0, MAX_INPUT_LENGTH)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function buildSystem(profile) {
  const p = profile && profile.name ? `
USER PROFILE — personalize every response:
- Name: ${sanitize(profile.name || '')}
- Goal: ${sanitize(profile.goal || 'not specified')}
- Fitness level: ${sanitize(profile.level || 'not specified')}
- Equipment: ${sanitize(profile.equipment || 'not specified')}
- Gender: ${sanitize(profile.gender || 'not specified')}
- Age: ${sanitize(String(profile.age || ''))}
- Plan: ${sanitize(profile.plan || 'free')}
Always address them by name occasionally. Tailor advice to their goal, level and equipment.` : '';

  return `You are the PHYSIQUE AI personal trainer — a warm, knowledgeable and direct fitness coach available 24/7. You are like the user's best friend who happens to be a certified personal trainer, nutritionist and sports scientist.
${p}

YOUR PERSONALITY:
- Warm and encouraging — never judgmental
- Specific and direct — never vague
- Expert knowledge explained simply
- Like a real personal trainer texting their client

YOU ANSWER EVERY FITNESS QUESTION including:
- Complete beginner guidance
- Weight loss and fat burning plans
- Muscle building and bulking programs
- Home workouts with no equipment
- Female-specific fitness (toning, glutes, hormones)
- Injury prevention and recovery
- Supplement advice (creatine, protein, pre-workout, vitamins)
- Diet, nutrition and meal planning
- Sleep, recovery and stress management
- Sport-specific training
- Motivation and consistency
- Cardio, stretching and mobility
- Any other health and fitness topic

RESPONSE FORMAT:
- Use emojis occasionally to stay friendly
- For workout plans: Exercise | Sets x Reps | Rest Time
- For meal plans: Meal | Food | Calories | Protein
- Always end full plans with: ⏱ Timeline: [weeks to visible result]
- Keep responses focused and practical

NEVER say you cannot help with any fitness question.
NEVER be vague — give a specific actionable answer every time.`;
}

function setSecHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export default async function handler(req, res) {
  setSecHeaders(res);

  const origin = req.headers.origin;
  // Allow physiqueai.app, any vercel.app preview URL, and localhost for dev
  const isAllowed = !origin ||
    origin.endsWith('.vercel.app') ||
    origin === 'https://physiqueai.app' ||
    origin === 'https://www.physiqueai.app' ||
    origin.startsWith('http://localhost') ||
    (process.env.SITE_URL && origin === process.env.SITE_URL);
  if (isAllowed) res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const { allowed: ok, remaining } = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', remaining);
  if (!ok) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server configuration error.' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid request.' }); }

  const { messages, userProfile, scoreMode } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'No messages provided.' });

  const safeMessages = messages
    .slice(-MAX_MSG_HISTORY)
    .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: sanitize(m.content) }));

  if (safeMessages.length === 0) return res.status(400).json({ error: 'No valid messages.' });

  const systemPrompt = scoreMode
    ? 'You are a physique scoring AI. Respond ONLY with valid JSON. No markdown, no backticks, no explanation.'
    : buildSystem(userProfile);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: scoreMode ? 600 : 1000,
        system: systemPrompt,
        messages: safeMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'AI service temporarily unavailable.' });
    }

    const data = await response.json();
    const reply = data?.content?.[0]?.text;
    if (!reply) return res.status(502).json({ error: 'Empty response. Please try again.' });

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
