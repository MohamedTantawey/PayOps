import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { trace, SpanStatusCode } from "@opentelemetry/api";
const g = globalThis as unknown as { payopsMetrics?: ReturnType<typeof setup> };
function setup() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({ name: "payops_operations_total", help: "Payment operations by result", labelNames: ["operation", "result"], registers: [registry] });
  const duration = new Histogram({ name: "payops_operation_duration_seconds", help: "Payment operation latency", labelNames: ["operation"], registers: [registry] });
  return { registry, requests, duration };
}
export const metrics = g.payopsMetrics ?? (g.payopsMetrics = setup());
export function observed<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer("payops").startActiveSpan(operation, async span => {
    const end = metrics.duration.startTimer({ operation });
    try { const result = await fn(); metrics.requests.inc({ operation, result: "ok" }); return result; }
    catch (error) { metrics.requests.inc({ operation, result: "error" }); span.setStatus({ code: SpanStatusCode.ERROR }); throw error; }
    finally { end(); span.end(); }
  });
}
