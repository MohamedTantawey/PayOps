// Commerce talks to the PayOps gateway here. Commerce never sees card data or provider keys.
import { createHmac, timingSafeEqual } from "crypto";

const base = process.env.GATEWAY_URL ?? "";
const key = process.env.GATEWAY_API_KEY ?? "";
// Placeholder or empty values mean: the gateway is not configured (Stripe or demo mode is used instead).
export const gatewayConfigured = base.startsWith("http") && key.startsWith("sk_") && !key.includes("REPLACE_ME");

// Gateway payment ids are UUIDs. Stripe references start with pi_ or cs_. Used to route refunds and expiry checks
// for orders created before the provider was switched.
export const isGatewayRef = (ref?: string | null) => !!ref && !/^(pi_|cs_)/.test(ref);

async function gw<T>(method: string, path: string, body?: unknown, idemKey?: string): Promise<T> {
  // The gateway answers 409 idempotency_conflict while another request with the same Idempotency-Key is still running.
  // The contract says to retry with the same key, so concurrent identical checkouts wait for the first one and get its result.
  // Network errors (for example a keep-alive socket the gateway had just closed) and 502/503/504 are retried with the same
  // Idempotency-Key, so a repeated request can never create a second payment. Requests without a key are not retried.
  const retryable = !!idemKey || method === "GET";
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(idemKey ? { "Idempotency-Key": idemKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (retryable && attempt < 4) { await new Promise((r) => setTimeout(r, 200 * (attempt + 1))); continue; }
      throw err;
    }
    if ([502, 503, 504].includes(res.status) && retryable && attempt < 4) { await new Promise((r) => setTimeout(r, 200 * (attempt + 1))); continue; }
    const json = (await res.json().catch(() => ({}))) as any;
    if (res.status === 409 && json?.error?.code === "idempotency_conflict" && idemKey && attempt < 12) {
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      continue;
    }
    if (!res.ok && !(path.endsWith("/refund") && json?.refund)) {
      const e: any = new Error(json?.error?.message ?? `Gateway HTTP ${res.status}`);
      e.status = res.status; e.code = json?.error?.code;
      throw e;
    }
    return json as T;
  }
}

// Replaces stripe.checkout.sessions.create. Returns the hosted card page URL (served by the gateway).
export async function createGatewayPayment(p: { orderId: string; amountCents: number; currency: string; description: string; customerEmail?: string; returnUrl: string; cancelUrl: string; idemKey: string }) {
  const r = await gw<any>("POST", "/api/payments", {
    amount_cents: p.amountCents, currency: p.currency, confirm: false, description: p.description,
    ...(p.customerEmail ? { customer_email: p.customerEmail } : {}),
    metadata: { order_id: p.orderId }, return_url: p.returnUrl, cancel_url: p.cancelUrl,
  }, p.idemKey);
  const publicBase = process.env.GATEWAY_PUBLIC_URL ?? base;
  return { intentId: r.intent.id as string, url: publicBase + r.intent.pay_path };
}

// Replaces stripe.refunds.create.
export async function refundGatewayPayment(intentId: string, amountCents: number, reason: string, idemKey: string) {
  const r = await gw<any>("POST", `/api/payments/${intentId}/refund`, { amount_cents: amountCents, reason }, idemKey);
  return { id: r.refund.id as string, status: r.refund.refund_status as string };
}

export const getGatewayPayment = (intentId: string) => gw<any>("GET", `/api/payments/${intentId}`);
export const cancelGatewayPayment = (intentId: string) => gw<any>("POST", `/api/payments/${intentId}/cancel`, {});

// Verifies X-PayOps-Signature = t=<ts>,v1=HMAC_SHA256(secret, ts + "." + rawBody). Rejects timestamps older than 5 minutes.
export function verifyGatewayWebhook(rawBody: string, headers: Headers, secret: string) {
  const ts = headers.get("x-payops-timestamp") ?? "";
  const v1 = (headers.get("x-payops-signature") ?? "").split(",").find((x) => x.trim().startsWith("v1="))?.trim().slice(3);
  if (!ts || !v1 || !/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
