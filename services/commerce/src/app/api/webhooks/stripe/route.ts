import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { financial } from "@/lib/transaction";
import { processEvent } from "@/lib/webhooks";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 1000000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let event: Stripe.Event | undefined;
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    if (!stripe || secret.includes("REPLACE_ME")) throw new Error("Webhook not configured");
    event = stripe.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch { /* Invalid bodies are hashed only, never executed or retained as raw data. */ }
  try {
    await db.webhookDelivery.create({ data: { eventId: event?.id, bodyHash: createHash("sha256").update(body).digest("hex"), valid: !!event } });
    if (!event) return NextResponse.json({ error: "Invalid signature or configuration" }, { status: 400 });
    const verified = event;
    await financial(tx => tx.webhookEvent.upsert({ where: { id: verified.id }, update: {}, create: { id: verified.id, type: verified.type, payload: JSON.parse(body) as Prisma.InputJsonValue } }));
    const state = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    if (state.nextAttemptAt <= new Date()) await processEvent(event.id);
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Event not completed; retry scheduled if stored" }, { status: 503 }); }
}
