import {commerce} from "@/lib/backend";
import { adminRead } from "@/lib/admin";
export const dynamic = "force-dynamic";
export default async function Events() {
  await adminRead("webhook-events");
  const events = await commerce('/api/views/events') as any[];
  const deliveries = await commerce('/api/views/deliveries') as any[];
  return <div><h1 className="text-2xl font-bold">Webhook states</h1><p className="my-4 text-zinc-400">Automatic backoff, five attempts, then DEAD. Correct the cause before an admin requeues a dead event through the API.</p>{events.map((e:any) => <article key={e.id} className="my-3 break-words rounded border border-zinc-700 p-4"><strong>{e.type}: {e.state}</strong><p className="break-all text-xs">{e.id} | attempts {e.attempts}</p><p>Next: {e.nextAttemptAt.toISOString()}</p><p className="text-rose-300">{e.lastError}</p></article>)}<h2 className="mt-8 text-xl">Recent deliveries (including invalid)</h2>{deliveries.map(d => <p className="my-2 break-all text-xs" key={d.id}>{d.receivedAt.toISOString()} | {d.eventId ?? "unverified"} | {d.valid ? "signature valid" : "rejected"} | hash {d.bodyHash}</p>)}</div>;
}
