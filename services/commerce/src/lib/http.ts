import { NextResponse } from "next/server";
import { ApiError } from "./transaction";
export function failure(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Operation failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "Operation not completed. Retry with the same idempotency key." }, { status: 503 });
}
