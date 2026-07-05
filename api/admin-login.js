export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD)
    return res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });
  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Invalid password' });

  const token = Buffer.from(process.env.ADMIN_PASSWORD).toString('base64');
  res.json({ ok: true, token });
}
