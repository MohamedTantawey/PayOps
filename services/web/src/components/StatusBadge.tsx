const styles: Record<string, string> = {
  PENDING: "bg-zinc-700/40 text-zinc-300",
  AUTHORIZED: "bg-sky-500/15 text-sky-300",
  PAID: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-rose-500/15 text-rose-300",
  CANCELED: "bg-zinc-700/40 text-zinc-400",
  REFUNDED: "bg-amber-500/15 text-amber-300",
  PARTIALLY_REFUNDED: "bg-amber-500/15 text-amber-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.PENDING}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
