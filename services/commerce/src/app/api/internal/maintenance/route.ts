import { NextResponse } from "next/server";
import { internalAuth } from "@/lib/auth";
import { maintenance } from "@/lib/webhooks";
import { failure } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(req: Request) { try { internalAuth(req); return NextResponse.json(await maintenance()); } catch (error) { return failure(error); } }
