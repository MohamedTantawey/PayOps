export const EGP_PER_USD = 50;

export function convertFromEgpCents(egpCents: number, currency: string): number {
  if (currency.toUpperCase() === "USD") {
    return Math.max(1, Math.round(egpCents / EGP_PER_USD));
  }
  return egpCents;
}

export function formatMoney(cents: number, currency = "egp"): string {
  const code = currency.toUpperCase();
  return new Intl.NumberFormat(code === "USD" ? "en-US" : "en-EG", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
