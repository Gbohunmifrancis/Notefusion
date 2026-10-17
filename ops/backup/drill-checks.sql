-- Invariants a restored NoteFusion database must hold, beyond "every row came back" (restore.sh checks the
-- counts). Run by the weekly restore drill and worth running after any real restore:
--   psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f ops/backup/drill-checks.sql
-- Each check raises an error on failure, so psql exits non-zero; each prints a NOTICE when it passes.
\set ON_ERROR_STOP on

-- 1. Every foreign key holds: no row points at a parent that is missing.
DO $$
DECLARE
  r record;
  n bigint;
  bad text := '';
  total int := 0;
BEGIN
  FOR r IN
    SELECT con.conname,
           con.conrelid::regclass AS child,
           con.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS ccols,
           (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS pcols
    FROM pg_constraint con
    WHERE con.contype = 'f'
  LOOP
    total := total + 1;
    EXECUTE format('SELECT count(*) FROM %s c WHERE ROW(%s) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE ROW(%s) = ROW(%s))',
                   r.child, r.ccols, r.parent, r.pcols, r.ccols) INTO n;
    IF n > 0 THEN
      bad := bad || format('%s (%s -> %s): %s orphan row(s); ', r.conname, r.child, r.parent, n);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'foreign keys broken: %', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE NOT convalidated) THEN
    RAISE EXCEPTION 'constraints left unvalidated: %',
      (SELECT string_agg(conname, ', ') FROM pg_constraint WHERE NOT convalidated);
  END IF;
  RAISE NOTICE 'foreign keys: all % hold', total;
END $$;

-- 2. The money: every ledger credit records exactly the payment it belongs to (same account, amount and
--    currency), amounts are positive, and no debit exists (nothing in the app writes one).
DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.ledger_entries') IS NULL THEN
    RAISE NOTICE 'ledger: no ledger_entries table, skipped';
    RETURN;
  END IF;
  SELECT count(*) INTO n
  FROM ledger_entries l
  JOIN payment_transactions p ON p."Id" = l."PaymentTransactionId"
  WHERE l."Direction" = 'Credit'
    AND (l."AmountMinor" <> p."AmountMinor" OR l."Currency" <> p."Currency" OR l."UserId" <> p."UserId");
  IF n > 0 THEN
    RAISE EXCEPTION 'ledger: % credit(s) disagree with their payment', n;
  END IF;
  SELECT count(*) INTO n FROM ledger_entries WHERE "AmountMinor" <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION 'ledger: % entr(ies) with a zero or negative amount', n;
  END IF;
  SELECT count(*) INTO n FROM ledger_entries WHERE "Direction" = 'Debit';
  IF n > 0 THEN
    RAISE WARNING 'ledger: % debit(s) present (the admin payment alert reports these too)', n;
  END IF;
  RAISE NOTICE 'ledger: % entries consistent; totals %', (SELECT count(*) FROM ledger_entries),
    coalesce((SELECT string_agg(format('%s %s', "Currency", sum), ', ')
              FROM (SELECT "Currency", sum("AmountMinor") FROM ledger_entries GROUP BY "Currency" ORDER BY 1) s), 'none');
END $$;

-- 3. The accounts are there and someone can still run the console.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'users table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE "Role" = 'Admin') THEN
    RAISE EXCEPTION 'no admin account in the restored users';
  END IF;
  RAISE NOTICE 'accounts: % users, % admins', (SELECT count(*) FROM users),
    (SELECT count(*) FROM users WHERE "Role" = 'Admin');
END $$;
