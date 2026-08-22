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

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function parseManualSaleDate(saleDate) {
  const match = String(saleDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  // Store manual sales at noon UTC so the selected calendar day does not shift
  // to the previous day for US time zones when rendered in the browser.
  return new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!BASE || !ANON_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  if (req.method === 'POST') {
    const { product_name, sale_date, value, qty, unit_price, source, discount_pct, customer_name, note } = req.body || {};
    const price = toNum(value);
    const unitPrice = toNum(unit_price) || price;
    const quantity = parseInt(qty || 1);
    const discountPct = Math.max(0, toNum(discount_pct));
    const subtotal = unitPrice * quantity;
    const discountAmt = Math.max(0, subtotal - price);
    if (!product_name || !sale_date || unitPrice <= 0 || quantity < 1 || price < 0) {
      return res.status(400).json({ error: 'product_name, sale_date, price, and quantity required' });
    }
    const d = parseManualSaleDate(sale_date);
    if (!d || Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid sale_date' });
    const orderNum = 'MANUAL-' + Date.now().toString().slice(-8);
    const payload = {
      order_num: orderNum,
      status: 'confirmed',
      customer_name: customer_name || 'Manual Entry',
      customer_email: '',
      phone: '',
      address: note || '',
      items: [{ name: product_name, qty: quantity, price: unitPrice, source: source || 'Website' }],
      subtotal,
      shipping: 0,
      discount_pct: discountPct || null,
      discount_amt: discountAmt,
      grand: price,
      confirmed_at: d.toISOString(),
      created_at: d.toISOString(),
    };
    const r = await sb('/orders', { method: 'POST', body: JSON.stringify(payload) }, true);
    const data = await r.json().catch(() => null);
    return res.status(r.status).json({ ok: r.ok, data });
  }

  if (req.method === 'DELETE') {
    const { id, order_num } = req.body || {};
    if (!id && !order_num) return res.status(400).json({ error: 'id or order_num required' });
    const filter = id ? `id=eq.${encodeURIComponent(id)}` : `order_num=eq.${encodeURIComponent(order_num)}`;
    const r = await sb(`/orders?${filter}`, { method: 'DELETE' }, true);
    return res.status(r.ok ? 200 : r.status).json({ ok: r.ok });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const r = await sb('/orders?select=*&status=in.(pending,confirmed)&order=created_at.desc&limit=5000', {}, true);
  const rows = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(rows)) {
    return res.status(r.status || 500).json({
      error: 'Could not load orders. Make sure the orders table exists in Supabase.',
      details: rows,
    });
  }

  const orders = rows.map(o => ({
    id: o.id,
    order_num: o.order_num,
    status: o.status || 'pending',
    customer_name: o.customer_name,
    customer_email: o.customer_email,
    phone: o.phone,
    address: o.address,
    items: Array.isArray(o.items) ? o.items : [],
    subtotal: toNum(o.subtotal),
    shipping: toNum(o.shipping),
    discount_amt: toNum(o.discount_amt),
    discount_pct: o.discount_pct,
    grand: toNum(o.grand),
    coupon_code: o.coupon_code,
    created_at: o.created_at,
    confirmed_at: o.confirmed_at || o.created_at,
  }));

  res.status(200).json({ orders });
}
