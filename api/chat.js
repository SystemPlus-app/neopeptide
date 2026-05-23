// api/chat.js — Neo Peptide AI Chat
// Receives: { message, history[] }
// Returns:  { reply }

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
- 99%+ purity verified by independent third-party labs
- Free shipping on orders over $150
- Discreet, temperature-controlled packaging

Hard Rules — Never:
- Diagnose any medical condition or disease
- Recommend specific dosages for individual users
- Claim products cure, treat, or prevent any disease
- Give personal medical advice
- Guarantee specific results for any individual
- Represent yourself as a doctor or medical professional

If asked medical questions: briefly acknowledge, recommend consulting a licensed healthcare provider, then redirect to product guidance.

Legal: All products are for research use only. Not for human consumption. Must be 21+.

Response style:
- Start naturally, never with "Hello!" every time
- If recommending a category, explain concisely why it fits their goal
- End with a natural follow-up question when appropriate
- Write in fluid prose, not bullet points`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ error: 'No message provided' });

  try {
    const contents = [
      ...(Array.isArray(history) ? history.slice(-8) : []),
      { role: 'user', parts: [{ text: message }] }
    ];

    const res2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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

    if (!res2.ok) {
      const err = await res2.json();
      throw new Error(err.error?.message || `Gemini ${res2.status}`);
    }

    const json = await res2.json();
    const reply =
      json.candidates?.[0]?.content?.parts?.[0]?.text ||
      'Thank you for your message. Our team will follow up with you shortly.';

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('[NeoPeptide AI]', err.message);
    return res.status(200).json({
      reply: 'Thank you for reaching out. Our team will be in touch within a few hours.'
    });
  }
};
