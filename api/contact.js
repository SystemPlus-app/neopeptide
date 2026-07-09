// api/contact.js — Contact widget lead notification
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM       = process.env.RESEND_FROM || 'Neo Peptide USA <Support@neopeptideus.com>';
const TO         = process.env.CONTACT_TO_EMAIL || 'support@peptideus.com';

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!r.ok) throw new Error(await r.text());
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, phone, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });

  try {
    await sendEmail(TO, `📩 New Contact Form Message — ${name}`,
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
        <h2 style="font-size:20px;font-weight:800;margin:0 0 18px">New Message from Website Contact Widget</h2>
        <div style="background:#f7f7f7;border-radius:12px;padding:20px 22px;margin-bottom:16px">
          <p style="margin:0 0 8px;font-size:14px"><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p style="margin:0 0 8px;font-size:14px"><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}" style="color:#1855E8">${escapeHtml(email)}</a></p>
          <p style="margin:0;font-size:14px"><strong>Phone:</strong> ${escapeHtml(phone) || '—'}</p>
        </div>
        ${message ? `<div style="background:#EDF4FF;border-radius:10px;padding:14px 18px;border:1px solid #C8D8F8">
          <p style="margin:0 0 6px;font-size:12px;color:#1855E8;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Message</p>
          <p style="margin:0;font-size:14px;color:#333;white-space:pre-wrap">${escapeHtml(message)}</p>
        </div>` : ''}
        <p style="color:#aaa;font-size:12px;margin:18px 0 0">Submitted via neopeptideus.com contact widget</p>
      </div>`
    );
  } catch (err) {
    return res.status(500).json({ error: 'Could not send message' });
  }

  return res.status(200).json({ ok: true });
}
