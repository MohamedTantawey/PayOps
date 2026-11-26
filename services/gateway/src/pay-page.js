import { escapeHtml as h, safeEqual } from './util.js';
import { confirmPayment, tokenize } from './payments.js';

const money = (c, cur) => `${(c / 100).toFixed(2)} ${cur}`;
const page = (body) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PayOps secure payment</title>
<style>*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;background:#f1f1f2;color:#313133;margin:0;min-height:100vh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.top{background:#172225;color:#fff;text-align:center;font-size:13px;padding:11px 16px}.top b{background:#f38b24;color:#171f22;font-size:11px;letter-spacing:1px;padding:5px 9px;margin-right:12px}
header{background:#fff;box-shadow:0 2px 5px #00000008}header div{max-width:1200px;margin:auto;padding:18px 16px;display:flex;align-items:center;justify-content:space-between}
.logo{font:bold 33px/.9 Arial,Helvetica,sans-serif;letter-spacing:-2px;color:#303034}.logo i{font-style:normal;color:#ed8621;font-size:38px;margin-left:3px;letter-spacing:0}.secure{font-size:12.5px;color:#777}
main{background:#fff;max-width:440px;width:calc(100% - 24px);margin:32px auto;border-radius:5px;overflow:hidden;box-shadow:0 3px 10px #00000008}.bar{background:#263b39;color:#fff;padding:14px 22px;font-size:17px;font-weight:700}.in{padding:24px 22px 26px}
h1{font-size:22px;margin:0 0 6px;letter-spacing:-.4px}.amt{font-size:30px;font-weight:700;color:#313133;letter-spacing:-.6px;margin:6px 0 16px}p{color:#777;font-size:14px;line-height:1.6}
label{display:block;font-size:13px;margin:14px 0 5px}input{width:100%;padding:11px;border:1px solid #ccc;border-radius:4px;font-size:15px;color:#333;background:#fff}input:focus{outline:2px solid #f3ae67;outline-offset:1px}
.row{display:flex;gap:10px}button{margin-top:20px;width:100%;min-height:46px;border:0;border-radius:4px;background:#ef861d;color:#fff;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 3px 7px #0002}button:hover{background:#d86c09}
.err{background:#fff4ef;color:#b33d32;padding:10px;border-radius:4px;margin:10px 0;font-size:13.5px}.hint{font-size:12px;color:#888;margin-top:14px;line-height:1.6}a{color:#c2630a}
footer{background:#303237;color:#a4a5a8;text-align:center;font-size:11px;padding:20px;margin-top:auto}</style>
<div class="top"><b>SECURE</b>Your card details go to the PayOps gateway, not the store.</div>
<header><div><span class="logo">PayOps<i>&#10035;</i></span><span class="secure">Secure payment</span></div></header>
<main><div class="bar">Secure payment</div><div class="in">${body}</div></main><footer>&copy; PayOps. Payments by the PayOps gateway.</footer></html>`;

function form(intent, error, mode) {
  const test = mode === 'test';
  return page(`<h1>Pay for your order</h1><div class="amt">${h(money(intent.amount_cents, intent.currency))}</div>${intent.description ? `<p>${h(intent.description)}</p>` : ''}
${error ? `<div class="err">${h(error)}</div>` : ''}
<form method="post" autocomplete="off"><input type="hidden" name="cs" value="${h(intent.client_secret)}">
<label>Card number</label><input name="number" inputmode="numeric" required value="${test ? '4242 4242 4242 4242' : ''}">
<div class="row"><div><label>Month</label><input name="exp_month" required value="${test ? '12' : ''}"></div><div><label>Year</label><input name="exp_year" required value="${test ? '2030' : ''}"></div><div><label>CVV</label><input name="cvv" required value="${test ? '123' : ''}"></div></div>
<button type="submit">Pay ${h(money(intent.amount_cents, intent.currency))}</button></form>
${test ? '<p class="hint">Test mode. No money moves. 4000 0000 0000 0002 declines, 4000 0000 0000 0341 triggers failover to the second connector.</p>' : ''}
${intent.cancel_url ? `<p class="hint"><a href="${h(intent.cancel_url)}">Cancel and go back</a></p>` : ''}`);
}

const attemptsByIntent = new Map();

export async function payPage(db, req, res, id, query, formBody) {
  const send = (status, html, headers = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', ...headers }); res.end(html); };
  const cs = (formBody ? formBody.get('cs') : query.get('cs')) || '';
  const { rows } = /^[0-9a-f-]{36}$/i.test(id) ? await db.query('SELECT * FROM payment_intents WHERE id=$1', [id]) : { rows: [] };
  const intent = rows[0];
  if (!intent || !safeEqual(intent.client_secret, cs)) return send(404, page('<h1>Payment not found</h1><p>This payment link is invalid.</p>'));
  const auth = { merchant_id: intent.merchant_id, env: intent.env_mode };
  const done = (status) => {
    if (intent.return_url) {
      const u = new URL(intent.return_url); u.searchParams.set('payment_intent', intent.id); u.searchParams.set('status', status);
      return send(303, '', { Location: u.toString() });
    }
    return send(200, page(`<h1>${status === 'succeeded' || status === 'requires_capture' ? 'Payment complete' : 'Payment failed'}</h1><p>You can close this page.</p>`));
  };
  if (!['requires_payment_method', 'requires_confirmation', 'failed'].includes(intent.status)) return done(intent.status);
  if (!formBody) return send(200, form(intent, null, intent.env_mode));
  const n = (attemptsByIntent.get(id) || 0) + 1; attemptsByIntent.set(id, n);
  if (n > 10) return send(429, page('<h1>Too many attempts</h1><p>Please start a new checkout.</p>'));
  try {
    const t = await tokenize(db, auth, { number: formBody.get('number'), exp_month: formBody.get('exp_month'), exp_year: formBody.get('exp_year'), cvv: formBody.get('cvv') });
    const out = await confirmPayment(db, auth, intent.id, { vault_token: t.token });
    const st = out.body.intent.status;
    if (st === 'failed') return send(402, form(intent, out.body.active_attempt?.error_message || 'Payment failed. Try another card.', intent.env_mode));
    return done(st);
  } catch (e) {
    if (e.status && e.status < 500) return send(400, form(intent, e.message, intent.env_mode));
    throw e;
  }
}
