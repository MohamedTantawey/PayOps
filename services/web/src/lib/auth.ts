import { timingSafeEqual, createHmac, createHash } from "crypto";
import { cookies, headers } from "next/headers";
import { ApiError } from "./transaction";
export type Actor = { name: string; role: "ops" | "finance" | "admin" };
function equal(a: string, b: string) { const ab = Buffer.from(a), bb = Buffer.from(b); return ab.length === bb.length && timingSafeEqual(ab, bb); }
export function tokenActor(token: string): Actor | null {
  // ADMIN_TOKENS is JSON, e.g. [{"name":"alice","role":"admin","token":"..."}]. No default credentials.
  let entries: (Actor & { token: string })[] = [];
  try { entries = JSON.parse(process.env.ADMIN_TOKENS ?? "[]"); if (!Array.isArray(entries)) return null; } catch { return null; }
  const match = entries.find(e => ["ops", "finance", "admin"].includes(e.role) && typeof e.token === "string" && e.token.length >= 24 && equal(e.token, token));
  return match ? { name: match.name, role: match.role } : null;
}
export function sessionActor(value: string): Actor | null {
  const [payload, signature] = value.split(".");
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (!equal(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    const entries = JSON.parse(process.env.ADMIN_TOKENS ?? "[]");
    if (!Array.isArray(entries)) return null;
    const match = entries.find((e: Actor & { token: string }) => e.name === data.name && createHash("sha256").update(e.token).digest("hex") === data.tokenHash);
    return match ? tokenActor(match.token) : null;
  } catch { return null; }
}
export function makeSession(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, "Configure SESSION_SECRET (32+ characters)");
  const payload = Buffer.from(JSON.stringify({ name: tokenActor(token)?.name, tokenHash: createHash("sha256").update(token).digest("hex"), exp: Date.now() + 3600000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
export async function currentActor() {
  const bearer = (await headers()).get("authorization")?.replace(/^Bearer /, "");
  return bearer ? tokenActor(bearer) : sessionActor((await cookies()).get("payops_session")?.value ?? "");
}
export async function requireRole(roles: Actor["role"][]): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new ApiError(401, "Authentication required");
  if (actor.role !== "admin" && !roles.includes(actor.role)) throw new ApiError(403, "Role not permitted");
  return actor;
}
export function internalAuth(req: Request) {
  const token = process.env.MAINTENANCE_TOKEN;
  if (!token || token.length < 24 || !equal(req.headers.get("authorization") ?? "", `Bearer ${token}`)) throw new ApiError(401, "Worker authentication required");
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").origin;
  if (origin && origin !== expected) throw new ApiError(403, "Cross-origin request rejected");
}
