export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
    const sdk = new NodeSDK({ traceExporter: new OTLPTraceExporter(), instrumentations: [new HttpInstrumentation()] });
    sdk.start();
    process.once("SIGTERM", () => { void sdk.shutdown(); });
  }
}
