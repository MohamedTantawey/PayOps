import { NextResponse } from "next/server";
import { requireRole, sameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure } from "@/lib/http";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const actor = await requireRole(["ops", "finance"]);
    await db.auditLog.create({ data: { actor: actor.name, role: actor.role, action: "logout", target: "session", why: "User signed out" } });
    const res = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"), 303);
    res.cookies.set("payops_session", "", { maxAge: 0, path: "/" }); return res;
  } catch (error) { return failure(error); }
}
