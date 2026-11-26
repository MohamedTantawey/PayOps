import { NextResponse } from "next/server";

type InvoiceOrder = {
  id: string;
  createdAt: string;
  totalCents: number;
  currency: string;
  status: string;
  demo?: boolean;
  customerEmail?: string;
};

class UpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Fetch the order from the customer orders API, forwarding the caller's session,
// so we can verify the order belongs to the logged-in customer.
async function fetchOrder(request: Request, orderId: string): Promise<InvoiceOrder | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = request.headers.get("cookie");
  const auth = request.headers.get("authorization");
  if (cookie) headers.cookie = cookie;
  if (auth) headers.authorization = auth;

  const r = await fetch(`${base}/api/customer/orders`, { headers, cache: "no-store" });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new UpstreamError(body.error || "Failed to fetch orders", r.status);
  }

  const data = await r.json();
  const orders: InvoiceOrder[] = data.orders ?? [];
  return orders.find((o) => o.id === orderId) ?? null;
}

// Maps the ecommerce order id to the PayOps order id. Override this if the two
// systems use different identifiers (e.g. stored in order metadata).
function mapEcommerceOrderIdToPayOps(orderId: string): string {
  return orderId;
}

export async function GET(request: Request) {
  try {
    const orderId = new URL(request.url).searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "orderId parameter is required" }, { status: 400 });
    }

    // Verify the order belongs to the logged-in customer before proxying.
    const order = await fetchOrder(request, orderId);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const payopsUrl = process.env.PAYOPS_URL;
    const payopsApiKey = process.env.PAYOPS_API_KEY;
    if (!payopsUrl || !payopsApiKey) {
      return NextResponse.json(
        { error: "PayOps invoice service is not configured." },
        { status: 503 }
      );
    }

    const payopsOrderId = mapEcommerceOrderIdToPayOps(orderId);
    const payopsRes = await fetch(`${payopsUrl}/api/v1/orders/${encodeURIComponent(payopsOrderId)}/invoice`, {
      headers: {
        authorization: `Bearer ${payopsApiKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });

    // Pass through PayOps status codes.
    if (payopsRes.status === 202) {
      return NextResponse.json({ status: "pending" }, { status: 202 });
    }
    if (payopsRes.status === 404 || payopsRes.status === 409) {
      const body = await payopsRes.json().catch(() => ({}));
      return NextResponse.json({ error: body.error || "Invoice unavailable" }, { status: payopsRes.status });
    }
    if (!payopsRes.ok) {
      return NextResponse.json({ error: "PayOps invoice service error." }, { status: 502 });
    }

    const safeName = orderId.replace(/[^\w-]/g, "_");
    const pdfBuffer = await payopsRes.arrayBuffer();

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${safeName}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error proxying invoice PDF:", error);
    if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to fetch invoice PDF" }, { status: 502 });
  }
}