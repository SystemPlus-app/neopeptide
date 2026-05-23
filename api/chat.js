// api/chat.js — Neo Peptide AI Chat Handler
// Vercel Serverless Function: Crisp webhook → Gemini → Crisp response

const SYSTEM_PROMPT = `You are the Neo Peptide AI assistant — the premium support voice of Neo Peptide USA, a medical-grade biotechnology and research compound company.

Brand Identity:
Neo Peptide delivers pharmaceutical-grade peptide research compounds with a focus on purity, science, and advanced performance optimization. All products are for legitimate research use only.

Tone:
- Premium, confident, and scientific
- Concise — keep replies under 3 short paragraphs maximum
- Intelligent and approachable — luxury biotech meets clinical precision
- Never robotic, spammy, or pushy
- Warm but precise

Your Role:
- Help visitors understand Neo Peptide's four research protocol categories
- Guide visitors toward the right category based on their stated goals
- Build trust through scientific credibility and transparency
- Answer questions about products, shipping, and ordering
- Encourage meaningful, ongoing conversation

Product Categories:
1. GLP-1 / Weight Loss — Semaglutide, Tirzepatide, Zepbound. Appetite control, metabolic reset, sustained fat loss. From $149/mo.
2. Longevity & Recovery — NAD+ Injectable, NAD+ Liposomal, Sermorelin. Cellular energy, DNA repair, deep sleep, anti-aging. From $80.
3. Testosterone / Hormone Optimization — Testosterone Cypionate, Oral Testosterone, Enclomiphene, Male Hormone Panel. Energy, drive, muscle, mood. From $79.
4. Microdosing / Light GLP-1 — Microdose Semaglutide, Microdose Tirzepatide. Low-dose entry protocols for appetite and energy balance. From $149.

Shipping & Operations:
- Ships within 48 hours from a USA GMP-certified facility
- Certificate of Analysis (COA) included with every batch
- ≥99% purity verified by independent third-party labs
- Free shipping on orders over $150
- Discreet, temperature-controlled packaging

Hard Rules — Never:
- Diagnose any medical condition or disease
- Recommend specific dosages for individual users
- Claim products cure, treat, or prevent any disease
- Give personal medical advice or guidance
- Guarantee specific results for any individual
- Represent yourself as a doctor or medical professional

If asked medical questions: briefly acknowledge the concern, recommend consulting a licensed healthcare provider, then redirect to how you can help with product and protocol guidance.

Legal: All products are for research use only. Not for human consumption. Must be 21+.

Response Format:
- Start naturally, not with "Hello!" every time
- If recommending a category, explain concisely why it fits their stated goal
- End with a natural follow-up question when appropriate to deepen the conversation
- Never use bullet points in responses — write in natural, fluid prose`;

const WEBSITE_ID = process.env.CRISP_WEBSITE_ID;
const API_ID     = process.env.CRISP_API_IDENTIFIER;
const API_KEY    = process.env.CRISP_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

function crispAuth() {
  return 'Basic ' + Buffer.from(`${API_ID}:${API_KEY}`).toString('base64');
}

async function fetchHistory(sessionId) {
  try {
    const res = await fetch(
      `https://api.crisp.chat/v1/website/${WEBSITE_ID}/conversation/${sessionId}/messages/0`,
      { headers: { Authorization: crispAuth(), 'X-Crisp-Tier': 'plugin' } }
    );
    if (!res.ok) return [];
    const { data } = await res.json();
    return (data || [])
      .filter(m => m.type === 'text' && (m.from === 'user' || m.from === 'operator'))
      .slice(-10)
      .map(m => ({ role: m.from === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  } catch {
    return [];
  }
}

async function isAssigned(sessionId) {
  try {
    const res = await fetch(
      `https://api.crisp.chat/v1/website/${WEBSITE_ID}/conversation/${sessionId}`,
      { headers: { Authorization: crispAuth(), 'X-Crisp-Tier': 'plugin' } }
    );
    if (!res.ok) return false;
    const { data } = await res.json();
    return data?.meta?.assigned === true;
  } catch {
    return false;
  }
}

async function geminiReply(userMessage, history) {
  // Build the conversation: history (minus last user msg) + current message
  const contents = [
    ...history.slice(0, -1),
    { role: 'user', parts: [{ text: userMessage }] }
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.72, maxOutputTokens: 420 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Gemini ${res.status}`);
  }

  const json = await res.json();
  return (
    json.candidates?.[0]?.content?.parts?.[0]?.text ||
    'Thank you for your message. A member of our team will follow up with you shortly.'
  );
}

async function sendCrispMessage(sessionId, content) {
  await fetch(
    `https://api.crisp.chat/v1/website/${WEBSITE_ID}/conversation/${sessionId}/message`,
    {
      method: 'POST',
      headers: {
        Authorization: crispAuth(),
        'Content-Type': 'application/json',
        'X-Crisp-Tier': 'plugin'
      },
      body: JSON.stringify({ type: 'text', from: 'operator', origin: 'chat', content })
    }
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { event, data } = req.body || {};

  // Only handle text messages sent by the visitor
  if (event !== 'message:send' || data?.from !== 'user' || data?.type !== 'text') {
    return res.status(200).json({ ok: true });
  }

  const { session_id: sessionId, content: userMessage } = data;
  if (!sessionId || !userMessage) return res.status(200).json({ ok: true });

  try {
    // Skip AI reply if a human operator has taken over the conversation
    const assigned = await isAssigned(sessionId);
    if (assigned) return res.status(200).json({ ok: true, skipped: 'human_active' });

    // Fetch recent conversation history for context-aware responses
    const history = await fetchHistory(sessionId);

    // Natural 900ms delay — avoids the instant-robot feel
    await new Promise(r => setTimeout(r, 900));

    // Generate response via Gemini
    const reply = await geminiReply(userMessage, history);

    // Send response through Crisp as an operator message
    await sendCrispMessage(sessionId, reply);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[NeoPeptide AI]', err.message);
    // Graceful fallback — never leave the visitor without a response
    try {
      await sendCrispMessage(
        sessionId,
        'Thanks for reaching out. Our team will get back to you within a few hours.'
      );
    } catch {}
    return res.status(200).json({ ok: true });
  }
};
