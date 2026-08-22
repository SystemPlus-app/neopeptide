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

  if (req.method === 'GET') {
    const r = await sb('/inventory?select=*&order=id');
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  if (req.method === 'POST') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { program, product_name, dose, price, quantity, available, auto_disable } = req.body || {};
    if (!program || !product_name || !dose) {
      return res.status(400).json({ error: 'program, product_name, and dose required' });
    }

    const product_slug = product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const payload = {
      program,
      product_name,
      product_slug,
      dose,
      price: price ?? 0,
      quantity: quantity ?? 0,
      available: available ?? false,
      auto_disable: auto_disable ?? true,
      updated_at: new Date().toISOString(),
    };

    const r = await sb('/inventory', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true);
    const data = await r.json();
    return res.status(r.status).json({ ok: r.ok, data });
  }

  if (req.method === 'PUT') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id, available, price, quantity, auto_disable } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const patch = { updated_at: new Date().toISOString() };
    if (available !== undefined) patch.available = available;
    if (price     !== undefined) patch.price     = price;
    if (auto_disable !== undefined) patch.auto_disable = auto_disable;
    if (quantity  !== undefined) {
      patch.quantity = quantity;
      if (Number(quantity) <= 0) patch.available = false;
    }

    const r = await sb(`/inventory?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }, true);
    const data = await r.json();
    return res.status(r.status).json({ ok: true, data });
  }

  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await sb(`/inventory?id=eq.${id}`, { method: 'DELETE' }, true);
    return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
  }

  res.status(405).end();
}
