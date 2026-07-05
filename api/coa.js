const BASE    = process.env.SUPABASE_URL;
const ANON    = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET  = 'coa';

function verifyAuth(req) {
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  try { return Buffer.from(auth, 'base64').toString() === process.env.ADMIN_PASSWORD; }
  catch { return false; }
}

async function ensureBucket() {
  await fetch(`${BASE}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!BASE) return res.status(500).json({ error: 'Supabase not configured' });

  const slug = req.query.slug;

  // ── GET all COAs → { slug: url, … }
  if (req.method === 'GET' && !slug) {
    const key = SERVICE || ANON;
    const r = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 500, offset: 0 }),
    });
    if (!r.ok) return res.status(200).json({});
    const files = await r.json();
    const map = {};
    if (Array.isArray(files)) {
      files.forEach(f => {
        const s = f.name.replace(/\.[^.]+$/, '');
        map[s] = `${BASE}/storage/v1/object/public/${BUCKET}/${f.name}`;
      });
    }
    return res.status(200).json(map);
  }

  // ── GET single COA → { url } or { url: null }
  if (req.method === 'GET' && slug) {
    const key = SERVICE || ANON;
    const r = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: slug, limit: 5, offset: 0 }),
    });
    if (!r.ok) return res.status(200).json({ url: null });
    const files = await r.json();
    if (!Array.isArray(files) || !files.length) return res.status(200).json({ url: null });
    const file = files.find(f => f.name.startsWith(slug));
    const url = file ? `${BASE}/storage/v1/object/public/${BUCKET}/${file.name}` : null;
    return res.status(200).json({ url });
  }

  // ── POST: upload COA (admin only)
  // Body: { slug, data (base64), contentType }
  if (req.method === 'POST') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (!SERVICE) return res.status(500).json({ error: 'Storage not configured' });
    const { slug: s, data, contentType } = req.body || {};
    if (!s || !data) return res.status(400).json({ error: 'slug and data required' });
    await ensureBucket();
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${s}.${ext}`;
    // delete old file (any extension) first
    await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [`${s}.jpg`, `${s}.png`, `${s}.webp`] }),
    });
    const buf = Buffer.from(data, 'base64');
    const up = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE}`,
        'Content-Type': contentType || 'image/jpeg',
        'x-upsert': 'true',
      },
      body: buf,
    });
    if (!up.ok) {
      const err = await up.text();
      return res.status(500).json({ error: err });
    }
    const url = `${BASE}/storage/v1/object/public/${BUCKET}/${path}`;
    return res.status(200).json({ ok: true, url });
  }

  // ── DELETE: remove COA (admin only)
  if (req.method === 'DELETE') {
    if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (!SERVICE || !slug) return res.status(400).json({ error: 'slug and service key required' });
    await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [`${slug}.jpg`, `${slug}.png`, `${slug}.webp`] }),
    });
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
}
