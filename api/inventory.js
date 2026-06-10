const BASE = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_ANON_KEY;

function sb(path, opts = {}) {
  return fetch(`${BASE}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!BASE || !KEY) return res.status(500).json({ error: 'Supabase not configured' });

  if (req.method === 'GET') {
    const r = await sb('/inventory?select=*&order=id');
    const data = await r.json();
    return res.status(r.status).json(data);
  }

  if (req.method === 'PUT') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id, available, price, quantity } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const patch = { updated_at: new Date().toISOString() };
    if (available !== undefined) patch.available = available;
    if (price     !== undefined) patch.price     = price;
    if (quantity  !== undefined) patch.quantity  = quantity;

    const r = await sb(`/inventory?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const data = await r.json();
    return res.status(r.status).json({ ok: true, data });
  }

  res.status(405).end();
}
