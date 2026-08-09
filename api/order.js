const BASE = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const DEFAULT_STORE_EMAIL = 'Support@neopeptideus.com';
const SUPPORT_EMAIL = 'Support@neopeptideus.com';

function emailList(value, fallback) {
  return String(value || fallback || '')
    .split(',')
    .map(email => email.trim())
    .filter(Boolean);
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalized(v) {
  return String(v || '').trim().toLowerCase().replace(/^np\s*-\s*rt3\b/, 'glp-3 (rt)');
}

async function validateInventory(items) {
  if (!BASE || !SUPABASE_KEY) {
    return { ok: false, error: 'Order database not configured' };
  }
  const r = await fetch(`${BASE}/rest/v1/inventory?select=product_name,dose,available,quantity`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return { ok: false, error: 'Could not validate inventory' };

  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows)) return { ok: false, error: 'Could not validate inventory' };

  for (const item of items || []) {
    const itemName = normalized(item?.name);
    const qty = Math.max(1, parseInt(item?.qty || 1));
    const sku = rows.find(row => normalized(`${row.product_name} ${row.dose}`) === itemName);

    if (!sku) return { ok: false, error: `${item?.name || 'Item'} is not available for purchase.` };
    if (sku.available === false || Number(sku.quantity) <= 0) {
      return { ok: false, error: `${item.name} is out of stock.` };
    }
    if (Number(sku.quantity) < qty) {
      return { ok: false, error: `Only ${sku.quantity} unit(s) of ${item.name} are available.` };
    }
  }

  return { ok: true };
}

async function saveOrder(order) {
  if (!BASE || !SUPABASE_KEY || !order?.orderNum) {
    return { ok: false, error: 'Order database not configured' };
  }
  try {
    const payload = {
      order_num: order.orderNum,
      status: 'pending',
      customer_name: order.customerName || '',
      customer_email: order.customerEmail || '',
      phone: order.phone || '',
      address: order.address || '',
      items: order.items || [],
      subtotal: toNum(order.total),
      shipping: order.shipping === 'Free' ? 0 : toNum(order.shipping),
      discount_pct: order.discountPct ? parseInt(order.discountPct) : null,
      discount_amt: toNum(order.discountAmt),
      coupon_code: order.couponCode || null,
      grand: toNum(order.grand),
    };
    const existing = await fetch(`${BASE}/rest/v1/orders?order_num=eq.${encodeURIComponent(order.orderNum)}&select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!existing.ok) throw new Error('Could not check existing order');
    const rows = await existing.json().catch(() => []);
    const hasOrder = Array.isArray(rows) && rows.length;
    const saved = await fetch(`${BASE}/rest/v1/orders${hasOrder ? `?id=eq.${rows[0].id}` : ''}`, {
      method: hasOrder ? 'PATCH' : 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!saved.ok) throw new Error('Could not save order');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Could not save order' };
  }
}

async function incrementCouponUses(code) {
  if (!BASE || !SUPABASE_KEY || !code) return;
  try {
    // increment total counter
    const r = await fetch(`${BASE}/rest/v1/coupons?code=eq.${encodeURIComponent(code)}&select=id,uses`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      const newUses = (rows[0].uses || 0) + 1;
      const patch = { uses: newUses };
      // deactivate after first use so coupon can only be used once
      if (newUses >= 1) patch.active = false;
      await fetch(`${BASE}/rest/v1/coupons?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
      });
    }
    // log individual use for monthly reporting
    await fetch(`${BASE}/rest/v1/coupon_uses`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ code: code.toUpperCase() }),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { customerEmail, customerName, items, total, shipping, grand, orderNum, address, phone, couponCode, discountPct, discountAmt } = req.body;
  const inventory = await validateInventory(items);
  if (!inventory.ok) return res.status(409).json({ error: inventory.error || 'An item is out of stock.' });

  const saved = await saveOrder({ customerEmail, customerName, items, total, shipping, grand, orderNum, address, phone, couponCode, discountPct, discountAmt });
  if (!saved.ok) return res.status(500).json({ error: saved.error || 'Could not save order' });

  const SMTP2GO_KEY = process.env.SMTP2GO_API_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!SMTP2GO_KEY && !RESEND_KEY) return res.status(500).json({ error: 'Email service not configured' });

  const origin = req.headers.origin || 'https://neopeptide.vercel.app';
  const tokenData = JSON.stringify({ v: 2, orderNum, email: customerEmail, items: items.map(i => ({ name: i.name, qty: i.qty })) });
  const token = Buffer.from(tokenData).toString('base64url');
  const confirmUrl = `${origin}/api/confirm?t=${token}`;

  const rowsHtml = items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px">${i.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;font-size:14px">${i.qty}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:14px;font-weight:700">$${(i.price * i.qty).toFixed(2)}</td>
    </tr>`).join('');

  const FROM = SMTP2GO_KEY
    ? (process.env.SMTP2GO_SENDER || 'Neo Peptide USA <Support@neopeptideus.com>')
    : (process.env.RESEND_FROM || 'Neo Peptide USA <onboarding@resend.dev>');
  const REPLY_TO = process.env.RESEND_REPLY_TO || process.env.ORDER_REPLY_TO_EMAIL || SUPPORT_EMAIL;
  const STORE_TO = emailList(process.env.ORDER_TO_EMAIL || process.env.CONTACT_TO_EMAIL, DEFAULT_STORE_EMAIL);

  async function sendViaSmtp2go(to, subject, html) {
    const r = await fetch('https://api.smtp2go.com/v3/email/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Smtp2go-Api-Key': SMTP2GO_KEY,
      },
      body: JSON.stringify({
        sender: FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html_body: html,
        text_body: subject,
        custom_headers: [{ header: 'Reply-To', value: REPLY_TO }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    const failed = data?.data?.failed || 0;
    const succeeded = data?.data?.succeeded || 0;
    if (!r.ok || failed > 0 || succeeded < 1) {
      console.error('SMTP2GO email failed', { to, subject, status: r.status, data });
      const failures = Array.isArray(data?.data?.failures) ? data.data.failures.join('; ') : '';
      throw new Error(failures || data?.data?.error || data?.message || 'SMTP2GO email delivery failed');
    }
    return data;
  }

  async function sendViaResend(to, subject, html) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html, reply_to: REPLY_TO })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Resend email failed', { to, subject, status: r.status, data });
      throw new Error(data?.message || data?.error || 'Email delivery failed');
    }
    return data;
  }

  async function send(to, subject, html) {
    return SMTP2GO_KEY ? sendViaSmtp2go(to, subject, html) : sendViaResend(to, subject, html);
  }

  try {
    // ── Email to customer ──────────────────────────────────────────
    await send(customerEmail, `Order ${orderNum} — Awaiting Payment Confirmation`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="font-size:22px;font-weight:800;margin:0 0 6px">Hi ${customerName},</h2>
      <p style="color:#555;margin:0 0 24px;font-size:15px">We received your order. It is <strong>awaiting Zelle payment</strong> to be processed and shipped.</p>
      <div style="background:#f7f7f7;border-radius:14px;padding:24px;margin-bottom:22px">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#888;margin:0 0 14px">Order ${orderNum}</p>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <th style="text-align:left;font-size:10px;text-transform:uppercase;color:#aaa;padding-bottom:8px;font-weight:700">Item</th>
            <th style="text-align:center;font-size:10px;text-transform:uppercase;color:#aaa;font-weight:700">Qty</th>
            <th style="text-align:right;font-size:10px;text-transform:uppercase;color:#aaa;font-weight:700">Price</th>
          </tr>
          ${rowsHtml}
        </table>
        <div style="margin-top:14px;padding-top:14px;border-top:2px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;color:#555">Shipping</span><span style="font-size:13px">${shipping}</span>
        </div>
        ${couponCode ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span style="font-size:13px;color:#16A34A">Coupon (${couponCode} −${discountPct}%)</span><span style="font-size:13px;color:#16A34A">−$${discountAmt}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span style="font-size:15px;font-weight:800">Total Due</span>
          <span style="font-size:20px;font-weight:900;font-family:monospace">$${grand}</span>
        </div>
      </div>
      <div style="background:#EDF4FF;border-radius:12px;padding:18px 22px;margin-bottom:22px;border:1px solid #C8D8F8">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#1855E8;margin:0 0 10px">Zelle Payment Instructions</p>
        <p style="margin:0 0 5px;font-size:14px"><strong>Send to:</strong> Support@neopeptideus.com</p>
        <p style="margin:0 0 5px;font-size:14px"><strong>Amount:</strong> $${grand}</p>
        <p style="margin:0;font-size:13px;color:#555">Include your order number <strong>${orderNum}</strong> in the memo field.</p>
      </div>
      <div style="background:#FFF7ED;border-radius:12px;padding:18px 22px;margin-bottom:22px;border:1px solid #FED7AA">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#EA580C;margin:0 0 8px">📸 Next Step — Send Payment Screenshot</p>
        <p style="margin:0;font-size:14px;color:#111;line-height:1.6">After sending your Zelle payment, please <strong>reply to this email</strong> with a screenshot of the payment confirmation so we can verify and process your order faster.</p>
      </div>
      <p style="color:#888;font-size:12px;line-height:1.6;margin:0">Once payment is confirmed you will receive a confirmation email and your order will ship within 48 hours.<br>Questions? Reply to this email or contact <a href="mailto:Support@neopeptideus.com" style="color:#1855E8">Support@neopeptideus.com</a>.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:22px 0">
      <p style="color:#ccc;font-size:11px;margin:0;line-height:1.6">For research use only. Not for human consumption. © 2025 Neo Peptide USA</p>
      </div>`
    );

    // ── Email to store ─────────────────────────────────────────────
    await send(STORE_TO, `🛒 New Order ${orderNum} — ${customerName} — $${grand}`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
      <h2 style="font-size:22px;font-weight:800;margin:0 0 4px">New Order: ${orderNum}</h2>
      <p style="color:#888;font-size:13px;margin:0 0 22px">${new Date().toLocaleString()}</p>
      <div style="background:#f7f7f7;border-radius:12px;padding:18px 22px;margin-bottom:18px">
        <p style="font-weight:700;margin:0 0 3px">${customerName}</p>
        <p style="color:#555;margin:0 0 3px;font-size:14px">${customerEmail}</p>
        <p style="color:#555;margin:0 0 3px;font-size:14px">${phone}</p>
        <p style="color:#555;margin:0;font-size:14px">${address}</p>
      </div>
      <div style="background:#f7f7f7;border-radius:12px;padding:18px 22px;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <th style="text-align:left;font-size:10px;text-transform:uppercase;color:#aaa;padding-bottom:8px;font-weight:700">Item</th>
            <th style="text-align:center;font-size:10px;text-transform:uppercase;color:#aaa;font-weight:700">Qty</th>
            <th style="text-align:right;font-size:10px;text-transform:uppercase;color:#aaa;font-weight:700">Price</th>
          </tr>
          ${rowsHtml}
        </table>
        <div style="margin-top:14px;padding-top:14px;border-top:2px solid #e0e0e0">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px"><span>Shipping</span><span>${shipping}</span></div>
          ${couponCode ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:#16A34A"><span>Coupon (${couponCode} −${discountPct}%)</span><span>−$${discountAmt}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900"><span>Total</span><span>$${grand}</span></div>
        </div>
      </div>
      <div style="text-align:center;margin:28px 0">
        <a href="${confirmUrl}" style="display:inline-block;background:#0A0A10;color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:.01em">
          ✓ Confirm Payment Received
        </a>
      </div>
      <p style="color:#aaa;font-size:12px;text-align:center;margin:0">Clicking the button sends the customer a payment confirmation email and marks the order as confirmed.</p>
      </div>`
    );
  } catch (e) {
    console.error('Order saved but notification email failed', {
      orderNum,
      customerEmail,
      storeTo: STORE_TO,
      error: e.message || e,
    });
    return res.status(200).json({
      success: true,
      emailSent: false,
      warning: 'Order was saved, but notification email could not be sent.',
    });
  }

  if (couponCode) await incrementCouponUses(couponCode);

  res.status(200).json({ success: true, emailSent: true });
}
