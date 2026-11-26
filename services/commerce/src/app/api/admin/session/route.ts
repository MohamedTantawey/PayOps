import { NextResponse } from "next/server";
import { tokenActor, makeSession, sameOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { failure } from "@/lib/http";
import { ApiError } from "@/lib/transaction";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const form = await req.formData(); const token = String(form.get("token") ?? ""); const actor = tokenActor(token);
    if (!actor) throw new ApiError(401, "Invalid token");
    const session = makeSession(token);
    await db.auditLog.create({ data: { actor: actor.name, role: actor.role, action: "login", target: "session", why: "Token sign in" } });
    const res = NextResponse.redirect(new URL("/admin", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"), 303);
    res.cookies.set("payops_session", session, { httpOnly: true, secure: process.env.COOKIE_SECURE === "true", sameSite: "strict", path: "/", maxAge: 3600 });
    return res;
  } catch (error) { return failure(error); }
}
