-- The API's own database login. It owns the application's tables, so its EF migrations can create and change
-- them, and it is nothing more: no superuser, no new databases or roles, no replication. A flaw in the API can
-- then reach the application's data but not the server behind it (COPY ... TO PROGRAM, ALTER SYSTEM, other
-- databases, other roles), which the superuser it used to connect as could.
--
-- Idempotent; the deploy runs it on every deploy as the database superuser, with the password set first:
--   { printf '\\set app_pw %s\n' "$APP_DB_PASSWORD"; cat ops/db/app-role.sql; } \
--     | docker compose -f docker-compose.prod.yml exec -T db psql -U notefusion -d notefusion
-- (piped, so the password never appears on a command line). Every run also hands it anything the superuser
-- created since (a restore, or a deploy that fell back to the superuser). On a new server, run the same.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE notefusion_app LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notefusion_app') \gexec

ALTER ROLE notefusion_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'app_pw';

GRANT CONNECT ON DATABASE notefusion TO notefusion_app;
GRANT USAGE, CREATE ON SCHEMA public TO notefusion_app;

-- Every table, view and sequence in public becomes its own. A table's indexes and the sequences behind its
-- identity or serial columns move with it (and cannot be moved on their own), so those sequences are skipped.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND pg_get_userbyid(c.relowner) <> 'notefusion_app'
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO notefusion_app',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
      r.relname);
  END LOOP;
END $$;
