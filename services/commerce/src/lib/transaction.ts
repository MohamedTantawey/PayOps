import { Prisma } from "@prisma/client";
import { db } from "./db";
export type Tx = Prisma.TransactionClient;
// Cross-process transaction lock. Keep provider/network calls OUTSIDE this lock.
// It intentionally serializes financial transitions for this starter's scale.
export function financial<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8346102)`;
    return fn(tx);
  }, { maxWait: 15000, timeout: 15000 });
}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
