const BASE = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sb(path, opts = {}, useServiceKey = false) {
  const key = useServiceKey && SERVICE_KEY ? SERVICE_KEY : ANON_KEY;
  return fetch(`${BASE}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function verifyAuth(req) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    return Buffer.from(auth, 'base64').toString() === process.env.ADMIN_PASSWORD;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BASE || !ANON_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  // Public: validate a single coupon by code
  if (req.method === 'GET' && req.query.code) {
    const code = req.query.code.trim().toUpperCase();
    const r = await sb(`/coupons?code=eq.${encodeURIComponent(code)}&active=eq.true&select=code,discount_pct`);
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Invalid or inactive coupon' });
    return res.status(200).json(data[0]);
  }

  // Admin: monthly usage stats
  if (req.method === 'GET' && req.query.stats) {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const r = await sb('/coupon_uses?select=code,used_at&order=used_at.desc&limit=5000');
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.status(500).json({ error: 'Failed to load stats' });
    const byMonth = {};
    rows.forEach(row => {
      const d = new Date(row.used_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = {};
      byMonth[key][row.code] = (byMonth[key][row.code] || 0) + 1;
    });
    return res.status(200).json(byMonth);
  }

  // Admin: list all coupons
  if (req.method === 'GET') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const r = await sb('/coupons?select=*&order=created_at.desc');
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  // Admin: create coupon
  if (req.method === 'POST') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { code, discount_pct } = req.body || {};
    if (!code || !discount_pct) return res.status(400).json({ error: 'code and discount_pct required' });
    const r = await sb('/coupons', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim().toUpperCase(), discount_pct: parseInt(discount_pct), uses: 0, active: true }),
    }, true);
    const data = await r.json();
    return res.status(r.status).json({ ok: r.ok, data });
  }

  // Admin: toggle active
  if (req.method === 'PUT') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id, active } = req.body || {};
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    const r = await sb(`/coupons?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }, true);
    return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
  }

  // Admin: delete coupon
  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await sb(`/coupons?id=eq.${id}`, { method: 'DELETE' }, true);
    return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
  }

  res.status(405).end();
}
