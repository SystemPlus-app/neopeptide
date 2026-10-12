const BASE = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_KEY = SERVICE_KEY || ANON_KEY;

function sb(path, opts = {}) {
  return fetch(`${BASE}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: DB_KEY,
      Authorization: `Bearer ${DB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

async function createLeadCoupon(code) {
  return sb('/coupons', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ code, discount_pct: 10, uses: 0, active: true }),
  });
}

async function responseError(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.message || body?.hint || body?.details || body?.error || fallback;
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

  if (!BASE || !DB_KEY) return res.status(500).json({ error: 'Supabase not configured: set SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY' });

  // Public: validate a single coupon by code
  if (req.method === 'GET' && req.query.code) {
    const code = req.query.code.trim().toUpperCase();
    const r = await sb(`/coupons?code=eq.${encodeURIComponent(code)}&select=code,discount_pct,active,uses&limit=1`);
    const data = await r.json().catch(() => null);
    if (!r.ok) return res.status(r.status).json({ error: data?.message || data?.hint || data?.details || data?.error || 'Could not validate coupon' });
    if (Array.isArray(data) && data.length) {
      if (!data[0].active || Number(data[0].uses) > 0) return res.status(409).json({ error: 'This coupon has already been used or is inactive.' });
      return res.status(200).json({ code: data[0].code, discount_pct: data[0].discount_pct });
    }

    const leadRes = await sb(`/leads?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
    const leads = await leadRes.json().catch(() => null);
    if (!leadRes.ok || !Array.isArray(leads) || !leads.length) {
      return res.status(404).json({ error: !leadRes.ok ? (leads?.message || leads?.hint || leads?.details || leads?.error || 'Could not validate coupon') : 'Invalid or inactive coupon' });
    }

    const usesRes = await sb(`/coupon_uses?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
    const uses = await usesRes.json().catch(() => null);
    if (usesRes.ok && Array.isArray(uses) && uses.length) {
      return res.status(409).json({ error: 'This coupon has already been used and cannot be reactivated.' });
    }

    const createRes = await createLeadCoupon(code);
    if (!createRes.ok) return res.status(createRes.status).json({ error: await responseError(createRes, 'Could not activate coupon') });
    return res.status(200).json({ code, discount_pct: 10 });
  }

  // Admin: monthly usage stats
  if (req.method === 'GET' && req.query.stats) {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const r = await sb('/coupon_uses?select=code,used_at&order=used_at.desc&limit=5000');
    const rows = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: rows?.message || rows?.hint || rows?.details || rows?.error || 'Failed to load stats' });
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
    return res.status(r.status).json(r.ok ? data : { error: data?.message || data?.hint || data?.details || data?.error || 'Failed to load coupons' });
  }

  // Admin: create coupon
  if (req.method === 'POST') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { code, discount_pct } = req.body || {};
    const pct = Number(discount_pct);
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode || !Number.isInteger(pct) || pct < 1 || pct > 100) return res.status(400).json({ error: 'code and discount_pct (1–100) are required' });
    const r = await sb('/coupons', {
      method: 'POST',
      body: JSON.stringify({ code: normalizedCode, discount_pct: pct, uses: 0, active: true }),
    });
    const data = await r.json();
    return res.status(r.status).json(r.ok ? { ok: true, data } : { ok: false, error: data?.message || data?.details || data?.hint || data?.error || 'Could not create coupon', data });
  }

  // Admin: toggle active
  if (req.method === 'PUT') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id, active } = req.body || {};
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be boolean' });
    if (active) {
      const current = await sb(`/coupons?id=eq.${encodeURIComponent(id)}&select=uses,active&limit=1`);
      const rows = await current.json().catch(() => []);
      if (!current.ok) return res.status(current.status).json({ error: await responseError(current, 'Could not load coupon') });
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Coupon not found' });
      if (Number(rows[0].uses) > 0) return res.status(409).json({ error: 'A used coupon cannot be reactivated.' });
    }
    const r = await sb(`/coupons?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    return res.status(r.ok ? 200 : r.status).json(r.ok ? { ok: true } : { ok: false, error: await responseError(r, 'Could not update coupon') });
  }

  // Admin: delete coupon
  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await sb(`/coupons?id=eq.${id}`, { method: 'DELETE' });
    return res.status(r.ok ? 200 : r.status).json(r.ok ? { ok: true } : { ok: false, error: await responseError(r, 'Could not delete coupon') });
  }

  res.status(405).end();
}
