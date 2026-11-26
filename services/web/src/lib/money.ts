export function formatMoney(cents: number, currency = "egp"): string {
  return new Intl.NumberFormat("en-EG", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
