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
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-PayOps-Mode": key.startsWith("sk_live_") ? "live" : "test",
      ...(idemKey ? { "Idempotency-Key": idemKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok && !(path.endsWith("/refund") && json?.refund)) {
    const e: any = new Error(json?.error?.message ?? `Gateway HTTP ${res.status}`);
    e.status = res.status; e.code = json?.error?.code;
    throw e;
  }
  return json as T;
}

// Replaces stripe.checkout.sessions.create. Returns the hosted card page URL (served by the gateway).
export async function createGatewayPayment(p: {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string;
  returnUrl: string;
  cancelUrl: string;
  idemKey: string;
  captureMethod?: "automatic" | "manual";
  vaultToken?: string;
  autoInvoice?: boolean;
  confirm?: boolean;
  paymentMethod?: string;
  simulateFailover?: boolean;
}) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
    throw new Error("amount_cents must be a strict positive integer");
  }
  const currency = p.currency.toUpperCase();
  if (currency !== "USD" && currency !== "EGP") {
    throw new Error(`Unsupported PayOps currency: ${p.currency}`);
  }
  const r = await gw<any>("POST", "/api/payments", {
    amount_cents: p.amountCents,
    currency,
    capture_method: p.captureMethod ?? "automatic",
    confirm: p.confirm ?? false,
    auto_invoice: p.autoInvoice ?? true,
    description: p.description,
    ...(p.customerEmail ? { customer_email: p.customerEmail } : {}),
    ...(p.vaultToken ? { vault_token: p.vaultToken } : {}),
    metadata: {
      order_id: p.orderId,
      ...(p.paymentMethod ? { payment_method: p.paymentMethod } : {}),
      ...(p.simulateFailover !== undefined ? { simulate_failover: p.simulateFailover } : {}),
    },
    return_url: p.returnUrl,
    cancel_url: p.cancelUrl,
  }, p.idemKey);
  const publicBase = process.env.GATEWAY_PUBLIC_URL || base;
  if (!r.intent?.id) throw new Error("Gateway did not return a payment intent id");
  const payPath = r.intent.pay_path as string | undefined;
  const url = payPath
    ? (publicBase.startsWith("http://") || publicBase.startsWith("https://")
        ? new URL(payPath, publicBase).toString()
        : publicBase + payPath)
    : `${p.returnUrl}`;
  return {
    intentId: r.intent.id as string,
    url,
    status: r.intent.status as string | undefined,
    routedConnector: (r.active_attempt?.connector ?? r.intent?.routed_connector ?? null) as string | null,
    routingSummary: (r.routing?.summary ?? null) as string | null,
  };
}

export type TokenizePayload =
  | { card: { number: string; exp_month: number; exp_year: number; cvv: string } }
  | { payment_method: "instapay" | "vodafone_cash" | "paypal"; account_identifier: string };

export async function tokenize(payload: TokenizePayload) {
  const r = await gw<any>("POST", "/api/payments/tokenize", payload);
  return {
    vault_token: (r.vault_token ?? r.token) as string,
    last4: (r.last4 ?? null) as string | null,
    network: (r.network ?? null) as string | null,
    raw: r,
  };
}

export async function capturePayment(intentId: string, amountCents?: number, idemKey?: string) {
  const body = amountCents !== undefined ? { amount_cents: amountCents } : {};
  const r = await gw<any>("POST", `/api/payments/${intentId}/capture`, body, idemKey);
  return {
    intentId: r.intent?.id as string,
    status: r.intent?.status as string,
    capturedAmountCents: Number(r.intent?.captured_amount_cents ?? amountCents ?? 0),
    routedConnector: (r.active_attempt?.connector ?? null) as string | null,
  };
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
