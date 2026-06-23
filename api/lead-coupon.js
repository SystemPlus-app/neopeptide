const BASE        = process.env.SUPABASE_URL;
const ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM        = process.env.RESEND_FROM || 'Neo Peptide USA <Support@neopeptideus.com>';

// Requires a `leads` table in Supabase:
// CREATE TABLE leads (id bigserial PRIMARY KEY, email text UNIQUE NOT NULL, name text, phone text, code text, created_at timestamptz DEFAULT now());

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'NEO' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { name, phone, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });

  const dbKey = SERVICE_KEY || ANON_KEY;

  // Check if email already registered
  if (BASE && dbKey) {
    try {
      const check = await fetch(
        `${BASE}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
        { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
      );
      if (check.ok) {
        const rows = await check.json();
        if (Array.isArray(rows) && rows.length > 0) {
          return res.status(200).json({ ok: true, duplicate: true });
        }
      }
    } catch (_) {}
  }

  const code = genCode();

  // Save lead to leads table (email unique)
  if (BASE && dbKey) {
    try {
      await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          apikey: dbKey,
          Authorization: `Bearer ${dbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ email, name, phone, code }),
      });
    } catch (_) {}
  }

  // Save coupon to coupons table
  if (BASE && dbKey) {
    try {
      await fetch(`${BASE}/rest/v1/coupons`, {
        method: 'POST',
        headers: {
          apikey: dbKey,
          Authorization: `Bearer ${dbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ code, discount_pct: 10, uses: 0, active: true }),
      });
    } catch (_) {}
  }

  // Email to customer with coupon
  try {
    await sendEmail(email, '🎁 Your 10% Off Coupon — Neo Peptide USA',
      `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#111">
        <div style="text-align:center;margin-bottom:28px">
          <img src="https://www.neopeptideus.com/fotos/logo/logo%20fundo%20preto.JPG" alt="Neo Peptide USA" style="height:52px;border-radius:8px">
        </div>
        <h2 style="font-size:24px;font-weight:800;text-align:center;margin:0 0 8px">Hi ${name}! 🎉</h2>
        <p style="color:#555;text-align:center;margin:0 0 28px;font-size:15px;line-height:1.6">Here's your exclusive 10% discount on your first order.</p>
        <div style="background:#0A0A10;border-radius:16px;padding:28px;text-align:center;margin-bottom:28px">
          <p style="color:#aaa;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px">Your Coupon Code</p>
          <div style="font-size:32px;font-weight:900;color:#fff;letter-spacing:.1em;font-family:monospace">${code}</div>
          <p style="color:#aaa;font-size:12px;margin:10px 0 0">10% off · one-time use only</p>
        </div>
        <div style="text-align:center;margin-bottom:28px">
          <a href="https://www.neopeptideus.com" style="display:inline-block;background:#1855E8;color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-weight:700;font-size:15px">Shop Now →</a>
        </div>
        <p style="color:#888;font-size:12px;text-align:center;line-height:1.6;margin:0">Enter the code at checkout. Valid for one purchase only.<br>Questions? <a href="mailto:Support@neopeptideus.com" style="color:#1855E8">Support@neopeptideus.com</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:22px 0">
        <p style="color:#ccc;font-size:11px;text-align:center;margin:0">You are receiving this email because you subscribed to promotions on neopeptideus.com.<br>For research use only. Not for human consumption. © 2025 Neo Peptide USA</p>
      </div>`
    );
  } catch (_) {}

  // Notification to store with lead info
  try {
    await sendEmail('Support@neopeptideus.com', `🙋 New Lead — ${name}`,
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
        <h2 style="font-size:20px;font-weight:800;margin:0 0 18px">New Lead from Website</h2>
        <div style="background:#f7f7f7;border-radius:12px;padding:20px 22px;margin-bottom:16px">
          <p style="margin:0 0 8px;font-size:14px"><strong>Name:</strong> ${name}</p>
          <p style="margin:0 0 8px;font-size:14px"><strong>Email:</strong> <a href="mailto:${email}" style="color:#1855E8">${email}</a></p>
          <p style="margin:0;font-size:14px"><strong>Phone:</strong> ${phone || '—'}</p>
        </div>
        <div style="background:#EDF4FF;border-radius:10px;padding:14px 18px;border:1px solid #C8D8F8">
          <p style="margin:0;font-size:13px;color:#1855E8"><strong>Coupon sent:</strong> ${code} (10% off, single use)</p>
        </div>
        <p style="color:#aaa;font-size:12px;margin:18px 0 0">Submitted via neopeptideus.com popup</p>
      </div>`
    );
  } catch (_) {}

  return res.status(200).json({ ok: true, code });
}
