import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/auth";
import { requireCustomer } from "@/lib/customer";
import { failure } from "@/lib/http";
import { ApiError, financial } from "@/lib/transaction";
import { capturePayment, gatewayConfigured } from "@/lib/gateway";
import { settlePayment } from "@/lib/payments";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const customer = await requireCustomer();
    const { id } = await context.params;
    const order = await db.order.findUnique({ where: { id } });
    if (!order || order.customerId !== customer.id) {
      throw new ApiError(404, "Order not found");
    }
    if (order.status !== "AUTHORIZED") {
      throw new ApiError(409, `Order must be AUTHORIZED to capture (currently ${order.status})`);
    }

    const intentId = order.stripePaymentIntent || order.stripeSessionId;
    let capturedAmountCents = order.totalCents;
    let routedConnector = order.routedConnector;

    if (!order.demo && gatewayConfigured) {
      if (!intentId) throw new ApiError(409, "Gateway payment intent reference is missing");
      const cap = await capturePayment(intentId, order.totalCents, `capture:${order.id}`);
      capturedAmountCents = cap.capturedAmountCents || order.totalCents;
      routedConnector = cap.routedConnector ?? routedConnector;
    }

    await financial((tx) =>
      settlePayment(tx, order.id, order.customerEmail, intentId, {
        capturedAmountCents,
        routedConnector,
      })
    );

    return NextResponse.json({
      captured: true,
      orderId: order.id,
      status: "PAID",
      capturedAmountCents,
      routedConnector,
    });
  } catch (e) {
    return failure(e);
  }
}
