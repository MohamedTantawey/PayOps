import { metrics } from "@/lib/observability";
export const dynamic = "force-dynamic";
export async function GET() { return new Response(await metrics.registry.metrics(), { headers: { "Content-Type": metrics.registry.contentType } }); }
