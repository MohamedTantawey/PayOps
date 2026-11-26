// One tick per minute, no secret in command-line arguments or logs.
const base = process.env.WORKER_APP_URL || "http://app:3000";
async function tick() {
  try {
    const result = await fetch(`${base}/api/internal/maintenance`, { method: "POST", headers: { Authorization: `Bearer ${process.env.MAINTENANCE_TOKEN}`, "x-service-token":process.env.COMMERCE_SERVICE_TOKEN||"" }, signal: AbortSignal.timeout(55000) });
    console.log("maintenance", result.status);
  } catch { console.error("maintenance unavailable"); }
}
await tick();
setInterval(tick, 60000);
