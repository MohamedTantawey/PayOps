// Estimated card-processing fee for demo/DB-only reconciliation:
// Stripe-like 2.9% + 30 piasters per charge. Real fees come from
// Stripe balance transactions once live keys are configured.
export function estimateFeeCents(amountCents: number): number {
  return Math.round(amountCents * 0.029) + 30;
}
