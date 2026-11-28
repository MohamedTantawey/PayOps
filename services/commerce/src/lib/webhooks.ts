import type Stripe from "stripe";
import { db } from "./db";
import { stripe } from "./stripe";
import { gatewayConfigured, isGatewayRef, getGatewayPayment, cancelGatewayPayment } from "./gateway";
import { financial, Tx } from "./transaction";
import { recordRefund, settlePayment, authorizePayment } from "./payments";
import { observed } from "./observability";
export async function releaseReservation(tx: Tx, orderId: string) {
  const reservations = await tx.reservation.findMany({ where: { orderId, state: "HELD" } });
  if (!reservations.length) return;
  for (const reservation of reservations) {
    await tx.reservation.update({ where: { id: reservation.id }, data: { state: "RELEASED" } });
    await tx.product.update({ where: { id: reservation.productId }, data: { stock: { increment: reservation.quantity } } });
  }
  await tx.order.updateMany({ where: { id: orderId, status: "PENDING" }, data: { status: "CANCELED" } });
}
type GatewayEvent = { id: string; event_type: string; data: { intent_id?: string; refund_id?: string; amount_cents?: number; currency?: string; metadata?: { order_id?: string } } };
async function processGatewayEvent(id: string, event: GatewayEvent) {
  return observed("webhook", async () => {
    try {
      await financial(async tx => {
        const latest = await tx.webhookEvent.findUniqueOrThrow({ where: { id } });
        if (["SUCCEEDED", "IGNORED", "DEAD"].includes(latest.state)) return;
        const d = event.data;
        let handled = true;
        if (event.event_type === "payment.succeeded") {
          const orderId = d.metadata?.order_id;
          if (!orderId || !d.intent_id) throw new Error("Order metadata missing");
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (d.amount_cents !== order.totalCents || String(d.currency).toLowerCase() !== order.currency) throw new Error("Payment amount/currency mismatch");
          // A late payment after release is never silently fulfilled.
          if (order.status === "CANCELED") throw new Error("Late payment requires manual inventory/refund review");
          await settlePayment(tx, orderId, undefined, d.intent_id);
        } else if (event.event_type === "payment.canceled") {
          const orderId = d.metadata?.order_id;
          if (!orderId) throw new Error("Order metadata missing");
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (d.amount_cents !== order.totalCents || String(d.currency).toLowerCase() !== order.currency) throw new Error("Payment amount/currency mismatch");
          if (order.status === "PENDING") await releaseReservation(tx, orderId);
        } else if (event.event_type === "refund.succeeded") {
          const order = d.intent_id ? await tx.order.findFirst({ where: { stripePaymentIntent: d.intent_id } }) : null;
          if (!order || !d.refund_id || typeof d.amount_cents !== "number") throw new Error("Order/payment not available yet");
          const known = await tx.refund.findUnique({ where: { stripeRefundId: d.refund_id } });
          const pending = known ? null : await tx.refund.findFirst({ where: { orderId: order.id, status: "pending", amountCents: d.amount_cents }, orderBy: { createdAt: "asc" } });
          await recordRefund(tx, order.id, known?.id || pending?.id || `external_${d.refund_id}`, d.amount_cents, d.refund_id, "Gateway refund webhook");
        } else handled = false; // payment.failed: the customer can retry on the gateway page; the reservation timer releases stock.
        await tx.webhookEvent.update({ where: { id }, data: { state: handled ? "SUCCEEDED" : "IGNORED", attempts: { increment: 1 }, lastError: null } });
      });
    } catch (error) {
      await financial(async tx => {
        const latest = await tx.webhookEvent.findUniqueOrThrow({ where: { id } });
        if (["SUCCEEDED", "IGNORED", "DEAD"].includes(latest.state)) return;
        const attempts = latest.attempts + 1;
        await tx.webhookEvent.update({ where: { id }, data: { attempts, state: attempts >= 5 ? "DEAD" : "FAILED", lastError: (error instanceof Error ? error.message : "Processing failure").slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000) } });
      });
      throw error;
    }
  });
}
export async function processEvent(id: string) {
  return observed("webhook", async () => {
    const stored = await db.webhookEvent.findUniqueOrThrow({ where: { id } });
    if (["SUCCEEDED", "IGNORED", "DEAD"].includes(stored.state)) return;
    if (typeof (stored.payload as { event_type?: unknown } | null)?.event_type === "string") return processGatewayEvent(id, stored.payload as unknown as GatewayEvent);
    const event = stored.payload as unknown as Stripe.Event;
    let providerRefunds: Stripe.Refund[] = [];
    try {
      if (event.type === "charge.refunded") {
        if (!stripe) throw new Error("Stripe not configured");
        const charge = event.data.object as Stripe.Charge;
        for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) providerRefunds.push(refund);
      }
      await financial(async tx => {
        const latest = await tx.webhookEvent.findUniqueOrThrow({ where: { id } });
        if (["SUCCEEDED", "IGNORED", "DEAD"].includes(latest.state)) return;
        let handled = true;
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.payment_status !== "paid") throw new Error("Payment not paid");
          const orderId = session.metadata?.orderId;
          if (!orderId) throw new Error("Order metadata missing");
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          if (session.amount_total !== order.totalCents || session.currency !== order.currency) throw new Error("Payment amount/currency mismatch");
          // A late payment after release is never silently fulfilled.
          if (order.status === "CANCELED") throw new Error("Late payment requires manual inventory/refund review");
          await settlePayment(tx, orderId, session.customer_details?.email, typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id);
        } else if (event.type === "checkout.session.expired") {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.metadata?.orderId) await releaseReservation(tx, session.metadata.orderId);
        } else if (event.type === "charge.refunded") {
          const charge = event.data.object as Stripe.Charge;
          const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
          const order = intent ? await tx.order.findFirst({ where: { stripePaymentIntent: intent } }) : null;
          if (!order) throw new Error("Order/payment not available yet");
          for (const refund of providerRefunds.filter(r => r.status === "succeeded")) {
            // Old provider metadata can be absent after a brand migration. Recover the
            // existing row by provider ID, or the one allowed pending full refund.
            const known = await tx.refund.findUnique({ where: { stripeRefundId: refund.id } });
            const pending = !known && !refund.metadata?.payopsRefundId ? await tx.refund.findFirst({ where: { orderId: order.id, status: "pending", amountCents: refund.amount }, orderBy: { createdAt: "asc" } }) : null;
            await recordRefund(tx, order.id, known?.id || refund.metadata?.payopsRefundId || pending?.id || `external_${refund.id}`, refund.amount, refund.id, "Stripe refund webhook");
          }
        } else handled = false;
        await tx.webhookEvent.update({ where: { id }, data: { state: handled ? "SUCCEEDED" : "IGNORED", attempts: { increment: 1 }, lastError: null } });
      });
    } catch (error) {
      await financial(async tx => {
        const latest = await tx.webhookEvent.findUniqueOrThrow({ where: { id } });
        if (["SUCCEEDED", "IGNORED", "DEAD"].includes(latest.state)) return;
        const attempts = latest.attempts + 1;
        await tx.webhookEvent.update({ where: { id }, data: { attempts, state: attempts >= 5 ? "DEAD" : "FAILED", lastError: (error instanceof Error ? error.message : "Processing failure").slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** attempts) * 1000) } });
      });
      throw error;
    }
  });
}
export async function maintenance() {
  const due = await db.webhookEvent.findMany({ where: { state: { in: ["RECEIVED", "FAILED"] }, nextAttemptAt: { lte: new Date() } }, take: 50, orderBy: { createdAt: "asc" } });
  for (const event of due) { try { await processEvent(event.id); } catch { /* state/error persisted for next worker tick */ } }
  const expired = await db.reservation.findMany({ where: { state: "HELD", expiresAt: { lte: new Date() } }, take: 100 });
  for (const reservation of expired) {
    const order = await db.order.findUniqueOrThrow({ where: { id: reservation.orderId } });
    if (!order.demo) {
      // Verify Stripe state before returning stock to avoid selling a paid unit twice.
      if (!order.stripeSessionId) continue;
      if (isGatewayRef(order.stripeSessionId)) {
        if (!gatewayConfigured) continue;
        const g = await getGatewayPayment(order.stripeSessionId);
        const status = g.intent.status as string;
        if (status === "succeeded") {
          // Paid, but the webhook was missed or is still queued. Settle it now rather than returning the stock.
          if (g.intent.amount_cents === order.totalCents && String(g.intent.currency).toLowerCase() === order.currency) await financial(tx => settlePayment(tx, order.id, undefined, order.stripeSessionId));
          continue;
        }
        if (status === "requires_capture") {
          if (g.intent.amount_cents === order.totalCents && String(g.intent.currency).toLowerCase() === order.currency) {
            await financial(tx => authorizePayment(tx, order.id, order.stripeSessionId));
          }
          continue;
        }
        if (status === "processing") continue;
        // Cancel first: if the customer pays at this exact moment the cancel is refused and we keep the stock.
        if (status !== "canceled") { try { await cancelGatewayPayment(order.stripeSessionId); } catch { continue; } }
      } else {
        if (!stripe) continue;
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        if (session.status !== "expired") continue;
      }
    }
    await financial(tx => releaseReservation(tx, order.id));
  }
  const messages=await db.outbox.findMany({where:{deliveredAt:null},take:50,orderBy:{createdAt:'asc'}});
  for(const message of messages){
    try{
      const r=await fetch(`${process.env.IDENTITY_URL}/v1/events/cart-purchased`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.IDENTITY_SERVICE_TOKEN}`},body:JSON.stringify({id:message.id,...message.payload as object}),signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw new Error(`Identity returned ${r.status}`);
      await db.outbox.update({where:{id:message.id},data:{deliveredAt:new Date(),attempts:{increment:1},lastError:null}});
    }catch(e){await db.outbox.update({where:{id:message.id},data:{attempts:{increment:1},lastError:e instanceof Error?e.message:'Delivery failed'}});}
  }
  return { outboxChecked:messages.length, eventsChecked: due.length, reservationsChecked: expired.length };
}
