import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth";
import { requireCustomer } from "@/lib/customer";
import { failure } from "@/lib/http";
import { createGatewayPayment, gatewayConfigured } from "@/lib/gateway";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const customer = await requireCustomer();
    const idemKey = `idem_demo_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    if (!gatewayConfigured) {
      return NextResponse.json({
        idempotencyKey: idemKey,
        mode: "demo",
        first: { status: 201, intentId: `demo_${idemKey}`, replayed: false },
        second: { status: 200, intentId: `demo_${idemKey}`, replayed: true },
        doubleChargePrevented: true,
      });
    }

    const payload = {
      orderId: `idem_probe_${Date.now()}`,
      amountCents: 1000,
      currency: "USD",
      description: "PayOps Idempotency Double-Submit Probe",
      customerEmail: customer.email,
      returnUrl: `${origin}/checkout/success`,
      cancelUrl: `${origin}/checkout/cancel`,
      idemKey,
      confirm: false,
      autoInvoice: false,
    };

    const [r1, r2] = await Promise.allSettled([
      createGatewayPayment(payload),
      createGatewayPayment(payload),
    ]);

    const formatOutcome = (r: PromiseSettledResult<Awaited<ReturnType<typeof createGatewayPayment>>>) =>
      r.status === "fulfilled"
        ? { ok: true, intentId: r.value.intentId, status: r.value.status ?? "created" }
        : { ok: false, status: (r.reason as any)?.status ?? 409, error: r.reason?.message ?? "Conflict" };

    const first = formatOutcome(r1);
    const second = formatOutcome(r2);
    const doubleChargePrevented =
      (first.ok && second.ok && first.intentId === second.intentId) ||
      ((first.ok || second.ok) && (!first.ok || !second.ok));

    return NextResponse.json({
      idempotencyKey: idemKey,
      mode: "payops",
      first,
      second,
      doubleChargePrevented,
    });
  } catch (e) {
    return failure(e);
  }
}
