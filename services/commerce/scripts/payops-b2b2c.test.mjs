import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("invoice proxy calls PayOps /api/invoices/orders/:orderId/invoice", () => {
  const src = readFileSync(resolve(root, "services/web/src/app/api/invoice/route.ts"), "utf8");
  assert.match(src, /\/api\/invoices\/orders\/\$\{encodeURIComponent\(payopsOrderId\)\}\/invoice/);
  assert.doesNotMatch(src, /\/api\/v1\/orders\//);
});

test("gateway.ts exports tokenize and capturePayment and enforces positive integer amount_cents", () => {
  const src = readFileSync(resolve(root, "services/commerce/src/lib/gateway.ts"), "utf8");
  assert.match(src, /export async function tokenize\(/);
  assert.match(src, /export async function capturePayment\(/);
  assert.match(src, /\/api\/payments\/tokenize/);
  assert.match(src, /\/api\/payments\/\$\{intentId\}\/capture/);
  assert.match(src, /Number\.isInteger\(p\.amountCents\)/);
});

test("payments.ts supports AUTHORIZED -> PAID transition and authorizePayment", () => {
  const src = readFileSync(resolve(root, "services/commerce/src/lib/payments.ts"), "utf8");
  assert.match(src, /export async function authorizePayment\(/);
  assert.match(src, /status:\s*"AUTHORIZED"/);
  assert.match(src, /order\.status !== "PENDING" && order\.status !== "AUTHORIZED"/);
});

test("Prisma schema includes AUTHORIZED status, Order routing fields, and SavedPaymentMethod", () => {
  const schema = readFileSync(resolve(root, "services/commerce/prisma/schema.prisma"), "utf8");
  assert.match(schema, /\bAUTHORIZED\b/);
  assert.match(schema, /routedConnector\s+String\?/);
  assert.match(schema, /capturedAmountCents\s+Int\?/);
  assert.match(schema, /model SavedPaymentMethod\b/);
});

test("web BFF proxy allowlists payment-methods, capture, sync, and idempotency-demo", () => {
  const proxy = readFileSync(resolve(root, "services/web/src/app/api/[...path]/route.ts"), "utf8");
  assert.match(proxy, /payment-methods/);
  assert.match(proxy, /idempotency-demo/);
  assert.match(proxy, /capture\|sync/);
});
