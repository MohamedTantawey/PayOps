import { Tx } from "./transaction";
import { db } from "./db";
export async function postMovement(tx: Tx, id: string, orderId: string, currency: string, amount: number, debit: string, credit: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || debit === credit) throw new Error("Invalid ledger movement");
  const exists = await tx.ledgerEntry.findFirst({ where: { movementId: id } });
  if (exists) return;
  await tx.ledgerEntry.createMany({ data: [
    { movementId: id, orderId, currency, account: debit, debitCents: amount },
    { movementId: id, orderId, currency, account: credit, creditCents: amount },
  ] });
}
export async function ledgerBalances() {
  const groups = await db.ledgerEntry.groupBy({ by: ["currency", "account"], _sum: { debitCents: true, creditCents: true } });
  return groups.map(g => ({ currency: g.currency, account: g.account, debit: g._sum.debitCents ?? 0, credit: g._sum.creditCents ?? 0, balance: (g._sum.debitCents ?? 0) - (g._sum.creditCents ?? 0) }));
}
