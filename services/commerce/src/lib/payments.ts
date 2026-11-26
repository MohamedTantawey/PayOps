import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { stripe, stripeConfigured } from "./stripe";
import { gatewayConfigured, isGatewayRef, createGatewayPayment, refundGatewayPayment } from "./gateway";
import { financial, ApiError, Tx } from "./transaction";
import { postMovement } from "./ledger";
import { Actor } from "./auth";
const json = (value: unknown) => value as Prisma.InputJsonValue;
export function requestKey(req: Request) {
  const key = req.headers.get("idempotency-key");
  if (!key || !/^[a-zA-Z0-9_-]{16,120}$/.test(key)) throw new ApiError(400, "Idempotency-Key required (16-120 letters, numbers, underscores or hyphens)");
  return key;
}
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export async function settlePayment(tx: Tx, orderId: string, email?: string | null, intent?: string | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "PENDING") return;
  const reservations = await tx.reservation.findMany({ where: { orderId } });
  if (!reservations.length || reservations.some(r => r.state !== "HELD")) throw new Error("Payment requires inventory review: reservation no longer held");
  await tx.reservation.updateMany({ where: { orderId, state: "HELD" }, data: { state: "COMMITTED" } });
  await tx.order.update({ where: { id: orderId }, data: { status: "PAID", ...(email ? { customerEmail: email } : {}), stripePaymentIntent: intent } });
  if (order.customerId) {
    const purchased = await tx.orderItem.findMany({where:{orderId}});
    await tx.outbox.upsert({where:{id:`cart:${orderId}`},update:{},create:{id:`cart:${orderId}`,kind:'cart.purchased',payload:{customerId:order.customerId,items:purchased.map(i=>({productId:i.productId,quantity:i.quantity}))}}});
  }
  await tx.payment.create({ data: { orderId, amountCents: order.totalCents, netCents: order.totalCents, currency: order.currency } });
  await postMovement(tx, `payment:${orderId}`, orderId, order.currency, order.totalCents, "stripe_clearing", "sales");
}
export async function checkout(key: string, productId: string, quantity: number, customerId?: string) {
  const id = `checkout:${key}`;
  const fp = fingerprint({ productId, quantity, ...(customerId ? { customerId } : {}) });
  const record = await financial(async tx => {
    const previous = await tx.idempotencyRecord.findUnique({ where: { id } });
    if (previous) { if (previous.fingerprint !== fp) throw new ApiError(409, "Key already used for another request"); return previous; }
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) throw new ApiError(404, "Product not found");
    const reserved = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
    if (reserved.count !== 1) throw new ApiError(409, "Insufficient available stock");
    const order = await tx.order.create({ data: { ...(customerId ? { customerId } : {}), totalCents: product.priceCents * quantity, currency: product.currency, demo: !(stripeConfigured || gatewayConfigured), items: { create: { productId, name: product.name, quantity, unitCents: product.priceCents } } } });
    // 35 minutes gives Stripe's 30-minute minimum a safe creation margin.
    const expiresAt = new Date(Date.now() + 35 * 60000);
    await tx.reservation.create({ data: { orderId: order.id, productId, quantity, expiresAt } });
    return tx.idempotencyRecord.create({ data: { id, fingerprint: fp, context: json({ orderId: order.id, product, quantity, expires: Math.floor(expiresAt.getTime() / 1000) }) } });
  });
  if (record.response) return record.response;
  const context = record.context as unknown as { orderId: string; product: { name: string; currency: string; priceCents: number }; quantity: number; expires: number };
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let url = `${origin}/checkout/success?demo=1&order=${context.orderId}`;
  let sessionId: string | undefined;
  if (gatewayConfigured) {
    // Gateway keeps idempotency keys for 24 hours; never create a fresh payment after that.
    if (Date.now() - record.createdAt.getTime() > 23 * 3600000) throw new ApiError(409, "Unresolved checkout requires operator review; do not use a new key");
    const payment = await createGatewayPayment({ orderId: context.orderId, amountCents: context.product.priceCents * context.quantity, currency: context.product.currency, description: context.product.name, returnUrl: `${origin}/checkout/success?order=${context.orderId}`, cancelUrl: `${origin}/checkout/cancel`, idemKey: id });
    url = payment.url; sessionId = payment.intentId;
  } else if (stripe) {
    // Never make a fresh provider request after Stripe's key retention window.
    if (Date.now() - record.createdAt.getTime() > 23 * 3600000) throw new ApiError(409, "Unresolved checkout requires operator review; do not use a new key");
    if (context.expires < Date.now() / 1000 + 1800) throw new ApiError(409, "Checkout preparation expired; operator review required");
    const session = await stripe.checkout.sessions.create({ mode: "payment", payment_method_types: ["card"], expires_at: context.expires, line_items: [{ quantity: context.quantity, price_data: { currency: context.product.currency, unit_amount: context.product.priceCents, product_data: { name: context.product.name } } }], metadata: { orderId: context.orderId }, success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/checkout/cancel` }, { idempotencyKey: id });
    if (!session.url) throw new Error("Stripe session URL unavailable");
    url = session.url; sessionId = session.id;
  }
  return financial(async tx => {
    const latest = await tx.idempotencyRecord.findUniqueOrThrow({ where: { id } });
    if (latest.response) return latest.response;
    if (sessionId) await tx.order.update({ where: { id: context.orderId }, data: { stripeSessionId: sessionId } });
    else await settlePayment(tx, context.orderId, "demo@payops.local");
    const response = { url, orderId: context.orderId };
    await tx.idempotencyRecord.update({ where: { id }, data: { response } });
    return response;
  });
}
export async function recordRefund(tx: Tx, orderId: string, refundId: string, amount: number, providerId?: string, why?: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const existing = providerId ? await tx.refund.findUnique({ where: { stripeRefundId: providerId } }) : await tx.refund.findUnique({ where: { id: refundId } });
  if (existing?.status === "succeeded") return;
  await tx.refund.upsert({ where: { id: existing?.id ?? refundId }, create: { id: refundId, orderId, amountCents: amount, stripeRefundId: providerId, reason: why, status: "succeeded" }, update: { status: "succeeded", stripeRefundId: providerId } });
  await postMovement(tx, `refund:${providerId ?? refundId}`, orderId, order.currency, amount, "refunds", "stripe_clearing");
  const total = await tx.refund.aggregate({ where: { orderId, status: "succeeded" }, _sum: { amountCents: true } });
  await tx.order.update({ where: { id: orderId }, data: { status: (total._sum.amountCents ?? 0) >= order.totalCents ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
}
export async function refund(key: string, orderId: string, why: string, actor: Actor) {
  const id = `refund:${key}`;
  const fp = fingerprint({ orderId, why });
  const record = await financial(async tx => {
    const previous = await tx.idempotencyRecord.findUnique({ where: { id } });
    if (previous) { if (previous.fingerprint !== fp) throw new ApiError(409, "Key already used for another request"); return previous; }
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { refunds: true } });
    if (!order || order.status !== "PAID" || order.refunds.length) throw new ApiError(409, "Only an unrefunded paid order can be fully refunded");
    if (!order.demo && (!(isGatewayRef(order.stripePaymentIntent) ? gatewayConfigured : stripe) || !order.stripePaymentIntent)) throw new ApiError(409, "Provider payment reference is unavailable");
    const pending = await tx.refund.create({ data: { orderId, amountCents: order.totalCents, status: "pending", reason: why } });
    await tx.auditLog.create({ data: { actor: actor.name, role: actor.role, action: "refund.request", target: orderId, why } });
    return tx.idempotencyRecord.create({ data: { id, fingerprint: fp, context: json({ refundId: pending.id, orderId, amount: order.totalCents, intent: order.stripePaymentIntent, demo: order.demo }) } });
  });
  if (record.response) return record.response;
  const context = record.context as unknown as { refundId: string; orderId: string; amount: number; intent: string; demo: boolean };
  let providerId: string | undefined;
  if (!context.demo) {
    if (Date.now() - record.createdAt.getTime() > 23 * 3600000) throw new ApiError(409, "Unresolved refund requires provider review");
    if (isGatewayRef(context.intent)) {
      const result = await refundGatewayPayment(context.intent, context.amount, why, context.refundId);
      if (result.status !== "succeeded") throw new ApiError(409, "Refund is pending or failed at the gateway; inspect events and retry same key");
      providerId = result.id;
    } else {
      if (!stripe) throw new Error("Stripe unavailable");
      const result = await stripe.refunds.create({ payment_intent: context.intent, amount: context.amount, metadata: { payopsRefundId: context.refundId } }, { idempotencyKey: context.refundId });
      if (result.status !== "succeeded") throw new ApiError(409, "Refund is pending or failed at provider; inspect events and retry same key");
      providerId = result.id;
    }
  }
  return financial(async tx => {
    const latest = await tx.idempotencyRecord.findUniqueOrThrow({ where: { id } });
    if (latest.response) return latest.response;
    await recordRefund(tx, context.orderId, context.refundId, context.amount, providerId, why);
    const response = { refunded: true, orderId, refundId: context.refundId };
    await tx.idempotencyRecord.update({ where: { id }, data: { response } });
    await tx.auditLog.create({ data: { actor: actor.name, role: actor.role, action: "refund.completed", target: orderId, why } });
    return response;
  });
}
