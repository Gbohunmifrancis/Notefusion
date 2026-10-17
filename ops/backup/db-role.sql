-- The backup container's own database login: it can read everything (to dump it), run a base backup and
-- add rows to backup_runs, and nothing else. It cannot change or delete application data, so a compromised
-- backup container cannot damage the database it protects.
--
-- Idempotent; the deploy runs it on every deploy as the database superuser, with the password set first:
--   { printf '\\set backup_pw %s\n' "$BACKUP_DB_PASSWORD"; cat ops/backup/db-role.sql; } \
--     | docker compose -f docker-compose.prod.yml exec -T db psql -U notefusion -d notefusion
-- (piped, so the password never appears on a command line). On a new server or provider, run the same.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE notefusion_backup LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notefusion_backup') \gexec

ALTER ROLE notefusion_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5
  PASSWORD :'backup_pw';

-- Read every table, sequence and setting (pg_dump; data_directory for wal-g).
GRANT pg_read_all_data TO notefusion_backup;
GRANT pg_read_all_settings TO notefusion_backup;
-- Start and stop a non-exclusive base backup (wal-g backup-push). A managed service (RDS, Cloud SQL…)
-- may refuse these two; it runs its own point-in-time recovery there (BACKUP_PHYSICAL=off), so a refusal
-- is reported and the rest carries on.
\set ON_ERROR_STOP off
GRANT EXECUTE ON FUNCTION pg_backup_start(text, boolean) TO notefusion_backup;
GRANT EXECUTE ON FUNCTION pg_backup_stop(boolean) TO notefusion_backup;
\set ON_ERROR_STOP on

-- Its one write. The table comes from an EF migration, which also grants this when the role already
-- exists; whichever of the two runs second completes the pair.
SELECT 'GRANT INSERT ON TABLE public.backup_runs TO notefusion_backup'
WHERE to_regclass('public.backup_runs') IS NOT NULL \gexec
