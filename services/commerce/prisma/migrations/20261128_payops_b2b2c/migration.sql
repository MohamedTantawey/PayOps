-- Non-breaking migration for PayOps B2B2C multi-currency, manual capture, routing telemetry, and PCI Vault saved payment methods.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT 'stripe_card',
  ADD COLUMN IF NOT EXISTS "captureMethod" TEXT NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS "routedConnector" TEXT,
  ADD COLUMN IF NOT EXISTS "routingSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "capturedAmountCents" INTEGER;

CREATE TABLE IF NOT EXISTS "SavedPaymentMethod" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "vaultToken" TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "last4" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedPaymentMethod_vaultToken_key" ON "SavedPaymentMethod"("vaultToken");
CREATE INDEX IF NOT EXISTS "SavedPaymentMethod_userId_idx" ON "SavedPaymentMethod"("userId");
