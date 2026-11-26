import {commerce} from "@/lib/backend";
import { adminRead } from "@/lib/admin";
export const dynamic = "force-dynamic";
export default async function Audit() {
  await adminRead("audit-log", []);
  const rows = await commerce('/api/views/audit') as any[];
  return <div><h1 className="text-2xl font-bold">Audit log</h1><p className="my-4">Latest 200 actions. UTC timestamps.</p>{rows.map((r:any) => <article key={r.id} className="my-3 break-words rounded border border-zinc-700 p-4"><strong>{r.actor} ({r.role}): {r.action}</strong><p>{r.target}</p><p>{r.why}</p><time className="text-xs text-zinc-400">{r.createdAt.toISOString()}</time></article>)}</div>;
}
