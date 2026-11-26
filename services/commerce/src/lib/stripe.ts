import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";

// Placeholder keys (from .env.example) mean: run in demo mode, no Stripe calls.
export const stripeConfigured =
  key.startsWith("sk_") && !key.includes("REPLACE_ME");

export const stripe = stripeConfigured ? new Stripe(key) : null;
