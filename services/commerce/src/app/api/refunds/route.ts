import { NextResponse } from "next/server";
import { refund, requestKey } from "@/lib/payments";
import { requireRole, sameOrigin } from "@/lib/auth";
import { ApiError } from "@/lib/transaction";
import { failure } from "@/lib/http";
import { observed } from "@/lib/observability";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const actor = await requireRole(["finance"]); const key = requestKey(req);
    const body = await req.json();
    if (typeof body.orderId !== "string" || typeof body.why !== "string" || body.why.trim().length < 3 || body.why.length > 500) throw new ApiError(400, "orderId and a reason (3-500 characters) required");
    return NextResponse.json(await observed("refund", () => refund(key, body.orderId, body.why.trim(), actor)));
  } catch (error) { return failure(error); }
}
