const DEFAULT_FROM = 'Neo Peptide USA <support@neopeptideus.com>';

function normalizeSender(sender) {
  return String(sender || DEFAULT_FROM).replace(/<([^>]+)>/, (_, email) => `<${email.toLowerCase()}>`);
}

// SMTP2GO rejects any From: on a domain that is not verified in Sending > Verified
// Senders, so never fall back to SMTP_USER (an outlook.com login) — only to a
// neopeptideus.com address.
export function defaultSender() {
  return process.env.SMTP2GO_FROM || process.env.ORDER_FROM_EMAIL || DEFAULT_FROM;
}

export function defaultReplyTo(fallback) {
  return process.env.SMTP2GO_REPLY_TO || process.env.ORDER_REPLY_TO_EMAIL || fallback || 'Support@neopeptideus.com';
}

function asRecipients(to) {
  return Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
}

export async function sendEmail({ to, subject, html, sender = defaultSender(), replyTo }) {
  const apiKey = process.env.SMTP2GO_API_KEY;
  if (!apiKey) throw new Error('SMTP2GO_API_KEY is not configured');

  const body = {
    sender: normalizeSender(sender),
    to: asRecipients(to),
    subject,
    html_body: html,
    fastaccept: false,
  };

  if (replyTo) {
    body.custom_headers = [{ header: 'Reply-To', value: replyTo }];
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Smtp2go-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.data?.failed > 0 || data?.data?.error) {
        const message =
          data?.data?.error ||
          data?.error ||
          data?.message ||
          'Email delivery failed';
        lastError = new Error(message);
        console.error('SMTP2GO email failed', JSON.stringify({
          sender: body.sender,
          to: body.to,
          subject,
          status: r.status,
          attempt,
          data,
        }));
      } else {
        console.log('SMTP2GO email accepted', {
          to: body.to,
          subject,
          emailId: data?.data?.email_id || null,
          succeeded: data?.data?.succeeded ?? null,
          failed: data?.data?.failed ?? null,
          attempt,
        });
        return data;
      }
    } catch (e) {
      lastError = e;
      console.error('SMTP2GO email request failed', { to: body.to, subject, attempt, error: e?.message || e });
    }

    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, attempt * 600));
    }
  }
  throw lastError || new Error('Email delivery failed');
}
