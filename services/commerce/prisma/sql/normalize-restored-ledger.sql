-- Run only after restoring an older backup into the NEW v1.5 database.
-- Replace old ledger guard names without changing financial records.
BEGIN;
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT t.tgname FROM pg_trigger t
    WHERE t.tgrelid = '"LedgerEntry"'::regclass AND NOT t.tgisinternal
      AND t.tgname NOT LIKE 'payops_%'
      AND (t.tgname LIKE '%\_ledger_balanced' ESCAPE '\' OR t.tgname LIKE '%\_ledger_immutable' ESCAPE '\')
  LOOP EXECUTE format('DROP TRIGGER %I ON "LedgerEntry"', item.tgname); END LOOP;
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid = '"LedgerEntry"'::regclass AND conname NOT LIKE 'payops_%'
      AND conname LIKE '%\_ledger_positive_leg' ESCAPE '\'
  LOOP EXECUTE format('ALTER TABLE "LedgerEntry" DROP CONSTRAINT %I', item.conname); END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
      AND p.proname NOT LIKE 'payops_%'
      AND (p.proname LIKE '%\_check_ledger' ESCAPE '\' OR p.proname LIKE '%\_immutable_ledger' ESCAPE '\')
  LOOP EXECUTE format('DROP FUNCTION %s', item.signature); END LOOP;
END $$;
COMMIT;
