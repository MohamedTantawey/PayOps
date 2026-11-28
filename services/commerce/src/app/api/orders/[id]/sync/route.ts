import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/auth";
import { requireCustomer } from "@/lib/customer";
import { failure } from "@/lib/http";
import { ApiError, financial } from "@/lib/transaction";
import { gatewayConfigured, getGatewayPayment } from "@/lib/gateway";
import { authorizePayment, settlePayment } from "@/lib/payments";
import { releaseReservation } from "@/lib/webhooks";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const customer = await requireCustomer();
    const { id } = await context.params;
    const order = await db.order.findUnique({ where: { id } });
    if (!order || order.customerId !== customer.id) {
      throw new ApiError(404, "Order not found");
    }

    const intentId = order.stripePaymentIntent || order.stripeSessionId;
    if (!order.demo && gatewayConfigured && intentId) {
      const g = await getGatewayPayment(intentId);
      const gwStatus = g.intent?.status as string | undefined;
      const routedConnector = (g.attempts?.[0]?.connector ?? g.active_attempt?.connector ?? order.routedConnector) as string | null;
      const routingSummary = (g.routing?.summary ?? order.routingSummary) as string | null;

      await db.order.update({
        where: { id: order.id },
        data: {
          ...(routedConnector ? { routedConnector } : {}),
          ...(routingSummary ? { routingSummary } : {}),
        },
      });

      if (gwStatus === "succeeded" && (order.status === "PENDING" || order.status === "AUTHORIZED")) {
        await financial((tx) =>
          settlePayment(tx, order.id, order.customerEmail, intentId, {
            capturedAmountCents: Number(g.intent?.captured_amount_cents ?? order.totalCents),
            routedConnector,
            routingSummary,
          })
        );
      } else if (gwStatus === "requires_capture" && order.status === "PENDING") {
        await financial((tx) =>
          authorizePayment(tx, order.id, intentId, { routedConnector, routingSummary })
        );
      } else if (gwStatus === "canceled" && order.status === "PENDING") {
        await financial((tx) => releaseReservation(tx, order.id));
      }
    }

    const updated = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        id: true,
        status: true,
        routedConnector: true,
        routingSummary: true,
        capturedAmountCents: true,
      },
    });
    return NextResponse.json({ synced: true, order: updated });
  } catch (e) {
    return failure(e);
  }
}
