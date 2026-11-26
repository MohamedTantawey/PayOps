import { NextResponse } from "next/server";
import { requireRole, sameOrigin } from "@/lib/auth";
import { financial, ApiError } from "@/lib/transaction";
import { failure } from "@/lib/http";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const actor = await requireRole([]); const { eventId, why } = await req.json();
    if (typeof eventId !== "string" || typeof why !== "string" || why.length < 3 || why.length > 500) throw new ApiError(400, "eventId and reason required");
    await financial(async tx => {
      const event = await tx.webhookEvent.findUnique({ where: { id: eventId } });
      if (!event || event.state !== "DEAD") throw new ApiError(409, "Only dead events can be requeued");
      await tx.webhookEvent.update({ where: { id: eventId }, data: { state: "RECEIVED", attempts: 0, nextAttemptAt: new Date() } });
      await tx.auditLog.create({ data: { actor: actor.name, role: actor.role, action: "event.requeue", target: eventId, why } });
    });
    return NextResponse.json({ queued: true });
  } catch (error) { return failure(error); }
}
