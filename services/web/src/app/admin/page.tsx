import { ledgerBalances } from "@/lib/ledger";
import { adminRead } from "@/lib/admin";
import Link from "next/link";
import {commerce} from "@/lib/backend";
import { formatMoney } from "@/lib/money";

import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

async function getStats() {
  try {
    const [orderCount, balances, recent] = await Promise.all([
      commerce('/api/views/stats').then(r=>r.orderCount),
      commerce('/api/views/stats').then(r=>r.balances as {currency:string;account:string;balance:number}[]),
      commerce('/api/views/orders') as Promise<any[]>,
    ]);
    return {
      orderCount,
      gross: -(balances.find(b => b.account === "sales" && b.currency === "egp")?.balance ?? 0),
      refunded: balances.find(b => b.account === "refunds" && b.currency === "egp")?.balance ?? 0,
      recent,
      dbReady: true,
    };
  } catch {
    return { orderCount: 0, gross: 0, refunded: 0, recent: [], dbReady: false };
  }
}

export default async function AdminDashboard() {
  await adminRead("dashboard");
  const stats = await getStats();
  const stripeConfigured = (await commerce('/api/views/stats')).stripeConfigured;
  const net = stats.gross - stats.refunded;

  const cards = [
    { label: "Gross volume (EGP)", value: formatMoney(stats.gross) },
    { label: "Refunded", value: formatMoney(stats.refunded) },
    { label: "Net revenue", value: formatMoney(net) },
    { label: "Orders", value: String(stats.orderCount) },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {!stripeConfigured && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Demo mode: Stripe keys are placeholders. Payments are simulated
          locally — set real test keys in .env to charge real test cards.
        </div>
      )}
      {!stats.dbReady && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Database not reachable. Start Postgres and run
          `docker compose logs commerce`.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5"
          >
            <p className="text-xs uppercase tracking-widest text-zinc-500">
              {c.label}
            </p>
            <p className="mt-2 text-2xl font-bold">{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Recent orders</h2>
      <div className="mt-4 space-y-3 md:hidden">{stats.recent.map((o:any) => <article key={o.id} className="rounded-xl border border-zinc-800 p-4"><p className="break-all text-xs">{o.id}</p><p className="my-2">{o.items.map((i:any) => `${i.name} x${i.quantity}`).join(", ") || "No line items"}</p><p className="mb-2 font-bold">{formatMoney(o.totalCents, o.currency)}</p><StatusBadge status={o.status} /></article>)}</div>
      <div className="mt-4 hidden md:block overflow-x-auto rounded-2xl border border-zinc-800/60">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/60 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {stats.recent.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No orders yet. Buy something from the storefront.
                </td>
              </tr>
            )}
            {stats.recent.map((o) => (
              <tr key={o.id} className="text-zinc-300">
                <td className="px-4 py-3 font-mono text-xs">
                  {o.id.slice(0, 10)}…
                  {o.demo && (
                    <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      DEMO
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {o.items.map((i:any) => `${i.name} ×${i.quantity}`).join(", ")}
                </td>
                <td className="px-4 py-3">{formatMoney(o.totalCents, o.currency)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {o.createdAt.toLocaleDateString("en-GB")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href="/admin/orders"
        className="mt-4 inline-block text-sm text-violet-400 hover:underline"
      >
        Manage all orders →
      </Link>
    </div>
  );
}
