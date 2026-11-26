import { customer } from "@/lib/customer";
import { NextResponse } from "next/server";
import { checkout, requestKey } from "@/lib/payments";
import { ApiError } from "@/lib/transaction";
import { failure } from "@/lib/http";
import { observed } from "@/lib/observability";
import { sameOrigin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const key = requestKey(req);
    const body = await req.json();
    const quantity = body.quantity ?? 1;
    if (typeof body.productId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new ApiError(400, "productId and integer quantity (1-10) required");
    const owner = await customer();
    return NextResponse.json(await observed("checkout", () => checkout(key, body.productId, quantity, owner?.id)));
  } catch (error) { return failure(error); }
}
