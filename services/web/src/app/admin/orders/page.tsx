import { FulfillmentForm } from "@/components/FulfillmentForm";
import {commerce} from "@/lib/backend";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { RefundForm } from "@/components/RefundForm";
import { adminRead } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const actor = await adminRead("orders");
  let orders: Awaited<ReturnType<typeof loadOrders>> = [];
  let dbReady = true;
  try {
    orders = await loadOrders();
  } catch {
    dbReady = false;
  }

  async function loadOrders() {
    return commerce('/api/views/orders') as Promise<any[]>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Orders</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Latest 50 orders. Finance and admin can refund with a required reason.
      </p>

      {!dbReady && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Database not reachable. Start Postgres and run the Prisma setup.
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">{orders.map((o:any) => <article key={o.id} className="rounded-xl border border-zinc-800 p-4"><p className="break-all font-mono text-xs">{o.id}</p><p className="my-2">{o.items.map((i:any) => `${i.name} x${i.quantity}`).join(", ") || "No line items"}</p><p className="my-2 font-bold">{formatMoney(o.totalCents, o.currency)}</p><StatusBadge status={o.status} /><p className="my-2 break-all text-xs text-zinc-400">{o.customerEmail ?? "No customer email"} | {o.createdAt.toLocaleDateString("en-GB")}</p>{o.shippingAddress && <p className="my-2 break-words text-xs text-zinc-400">{Object.values(o.shippingAddress as Record<string,string>).join(", ")}</p>}{o.status === "PAID" && actor.role !== "ops" && <RefundForm orderId={o.id} />}{o.status === "PAID" && actor.role !== "finance" && <FulfillmentForm orderId={o.id} current={o.fulfillment} trackingNumber={o.trackingNumber} trackingUrl={o.trackingUrl}/> }</article>)}</div>


    </div>
  );
}
