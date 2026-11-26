import {commerce} from "@/lib/backend";
import { ledgerBalances } from "@/lib/ledger";
import { adminRead } from "@/lib/admin";
import { formatMoney } from "@/lib/money";
export const dynamic = "force-dynamic";
export default async function PayoutsPage() {
  await adminRead("ledger", ["finance"]);
  const balances = await ledgerBalances();
  const entries = await commerce('/api/views/ledger').then(r=>r.entries) as any[];
  const totals = new Map<string, number>(); for (const b of balances) totals.set(b.currency, (totals.get(b.currency) ?? 0) + b.balance);
  return <div><h1 className="text-2xl font-bold">Ledger & reconciliation</h1><p className="my-4 text-sm text-zinc-400">Balances derive from all ledger entries, not the 100-entry preview below. Stripe clearing is gross receipts less successful refunds. Fees and actual bank payouts are not imported; this is not bank settlement reconciliation.</p>{[...totals].map(([currency, value]) => <p key={currency}>Trial balance {currency.toUpperCase()}: {formatMoney(value, currency)} {value === 0 ? "(balanced)" : "INVESTIGATE"}</p>)}<div className="my-5 grid gap-3 sm:grid-cols-2">{balances.map(b => <div key={b.currency + b.account} className="rounded border border-zinc-700 p-4"><p>{b.account} ({b.currency})</p><strong>{formatMoney(b.balance, b.currency)}</strong><p className="text-xs text-zinc-400">Debit-positive / credit-negative</p></div>)}</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Movement", "Account", "Debit", "Credit", "Currency"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{entries.map((e:any) => <tr key={e.id}><td className="p-2 break-all">{e.movementId}</td><td className="p-2">{e.account}</td><td className="p-2">{e.debitCents}</td><td className="p-2">{e.creditCents}</td><td className="p-2">{e.currency}</td></tr>)}</tbody></table></div></div>;
}
