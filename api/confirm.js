export default async function handler(req, res) {
  const { t } = req.query;
  if (!t) return res.status(400).send('<p>Invalid confirmation link.</p>');

  let orderNum, customerEmail;
  try {
    const decoded = Buffer.from(t, 'base64url').toString();
    [orderNum, customerEmail] = decoded.split('||');
    if (!orderNum || !customerEmail) throw new Error('bad token');
  } catch {
    return res.status(400).send('<p>Invalid or expired confirmation link.</p>');
  }

  const KEY = process.env.RESEND_API_KEY;
  if (KEY && customerEmail) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Neo Peptide USA <orders@neopeptideusa.com>',
        to: customerEmail,
        subject: `✅ Order ${orderNum} Confirmed — Ships Within 48h`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111">
          <div style="background:#DCFCE7;border-radius:14px;padding:28px 24px;text-align:center;margin-bottom:28px">
            <div style="font-size:44px;margin-bottom:10px">✅</div>
            <h2 style="font-size:22px;font-weight:800;color:#15803D;margin:0 0 8px">Payment Confirmed!</h2>
            <p style="color:#166534;margin:0;font-size:15px">Your order <strong>${orderNum}</strong> has been confirmed and is being prepared for shipment.</p>
          </div>
          <div style="background:#f7f7f7;border-radius:12px;padding:18px 22px;margin-bottom:20px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px"><span style="font-weight:600">Order #</span><span>${orderNum}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:14px"><span style="font-weight:600">Ships within</span><span style="color:#15803D;font-weight:700">48 hours</span></div>
          </div>
          <p style="color:#555;text-align:center;margin:0 0 22px;font-size:14px;line-height:1.7">You will receive tracking information once your order ships.<br>Questions? Contact <a href="mailto:neopeptides@outlook.com" style="color:#1855E8">neopeptides@outlook.com</a>.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
          <p style="color:#ccc;font-size:11px;margin:0;text-align:center;line-height:1.6">For research use only. Not for human consumption. © 2025 Neo Peptide USA</p>
        </div>`
      })
    });
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment Confirmed — Neo Peptide</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F5F0EB;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .box{background:#fff;border-radius:22px;padding:48px 40px;max-width:460px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.1)}
  .icon{font-size:52px;margin-bottom:16px}
  h1{font-size:26px;font-weight:800;letter-spacing:-.02em;color:#0A0A10;margin-bottom:10px}
  .sub{font-size:15px;color:#555;line-height:1.6;margin-bottom:22px}
  .badge{display:inline-block;background:#DCFCE7;color:#15803D;font-weight:700;font-size:13px;padding:6px 16px;border-radius:100px;margin-bottom:22px}
  .note{font-size:13px;color:#888;line-height:1.6}
  a.home{display:inline-block;margin-top:24px;background:#0A0A10;color:#fff;text-decoration:none;padding:14px 36px;border-radius:100px;font-weight:700;font-size:14px;letter-spacing:.01em}
</style>
</head>
<body>
  <div class="box">
    <div class="icon">✅</div>
    <h1>Payment Confirmed</h1>
    <p class="sub">The customer has been notified and their order is being prepared for shipment.</p>
    <div class="badge">Order ${orderNum}</div>
    <p class="note">A confirmation email has been sent to the customer. The order will ship within 48 hours.</p>
    <a class="home" href="https://neopeptide.vercel.app">Back to Site</a>
  </div>
</body>
</html>`);
}
