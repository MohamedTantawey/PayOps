-- Run after prisma db push. Deferred constraint checks the final transaction,
-- allowing both legs to be inserted together. Existing data must be backfilled first.
CREATE OR REPLACE FUNCTION payops_check_ledger() RETURNS trigger AS $$
DECLARE movement text; legs int; delta bigint; currencies int;
BEGIN
  IF TG_OP = 'DELETE' THEN movement := OLD."movementId"; ELSE movement := NEW."movementId"; END IF;
  SELECT count(*), COALESCE(sum("debitCents" - "creditCents"),0), count(DISTINCT currency)
    INTO legs, delta, currencies FROM "LedgerEntry" WHERE "movementId" = movement;
  IF legs < 2 OR delta <> 0 OR currencies <> 1 THEN RAISE EXCEPTION 'Unbalanced ledger movement %', movement; END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payops_ledger_balanced') THEN
    CREATE CONSTRAINT TRIGGER payops_ledger_balanced AFTER INSERT OR UPDATE OR DELETE ON "LedgerEntry"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payops_check_ledger();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payops_ledger_positive_leg') THEN
    ALTER TABLE "LedgerEntry" ADD CONSTRAINT payops_ledger_positive_leg CHECK
      (("debitCents" > 0 AND "creditCents" = 0) OR ("creditCents" > 0 AND "debitCents" = 0));
  END IF;
END $$;
CREATE OR REPLACE FUNCTION payops_immutable_ledger() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Ledger is append-only; post a reversing movement instead'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payops_ledger_immutable ON "LedgerEntry";
CREATE TRIGGER payops_ledger_immutable BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION payops_immutable_ledger();
