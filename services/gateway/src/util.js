import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const uuid = () => randomUUID();
export const rand = (n = 12) => randomBytes(n).toString('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export const iso = (d) => (d instanceof Date ? d.toISOString() : d);
export function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) { let n = +num[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
export function cardNetwork(n) {
  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^(6011|65)/.test(n)) return 'discover';
  return 'unknown';
}
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isHttpUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
export function log(obj) { process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n'); }
export const metrics = { requests: {}, payments: {}, webhooks: {}, connector: {} };
export const inc = (group, key) => { metrics[group][key] = (metrics[group][key] || 0) + 1; };
