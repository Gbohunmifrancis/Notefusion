#!/usr/bin/env bash
# Restores a logical dump into ANY PostgreSQL 16+ (a VM, RDS, Cloud SQL, Azure, Neon, Supabase, a laptop)
# and proves it: every table's row count must equal the manifest taken in the dump's own snapshot, and
# the EF migrations must be the same list.
#
#   restore.sh --target-url postgres://USER:PASS@HOST:5432/DBNAME [options]
#     --snapshot ID|latest   which dump (default latest; list them: nf-backup-env restic snapshots --tag db)
#     --with-roles           also apply globals.sql (roles). Needs a superuser; managed providers usually
#                            refuse it, and the app does not need it (the target URL's user owns everything).
#     --jobs N               parallel restore (default 2)
#     --allow-nonempty       restore into a database that already has tables (default: refuse)
#     --keep-files DIR       leave the downloaded dump, globals.sql and manifest.json in DIR
#     --report FILE          write the comparison as JSON (the restore drill uses it)
#     --from-dir DIR         use a dump already downloaded (notefusion.dump + manifest.json) instead of restic
#
# Needs: restic (unless --from-dir), pg_restore and psql 16 or newer, jq, sha256sum; and the BACKUP_*
# settings (docs/BACKUP_AND_MIGRATION.md) or RESTIC_REPOSITORY + RESTIC_PASSWORD. The backup image has all
# of it:  docker run --rm -it --env-file backup.env ghcr.io/gbohunmifrancis/notefusion-backup restore.sh ...
set -Eeuo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for lib in "$here/nf-backup-lib.sh" "$here/scripts/nf-backup-lib.sh" /usr/local/bin/nf-backup-lib.sh; do
  # shellcheck source=scripts/nf-backup-lib.sh
  [ -f "$lib" ] && { . "$lib"; break; }
done
export NF_JOB=restore

target="" snapshot=latest with_roles=false jobs=2 allow_nonempty=false keep="" report="" from_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target-url) target=$2; shift 2 ;;
    --snapshot) snapshot=$2; shift 2 ;;
    --with-roles) with_roles=true; shift ;;
    --jobs) jobs=$2; shift 2 ;;
    --allow-nonempty) allow_nonempty=true; shift ;;
    --keep-files) keep=$2; shift 2 ;;
    --report) report=$2; shift 2 ;;
    --from-dir) from_dir=$2; shift 2 ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[ -n "$target" ] || die "--target-url is required (see --help)"
for tool in pg_restore psql jq sha256sum; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
# Read without a pipe: under pipefail, `| head -1` closing early killed busybox grep's second write
# ("16", then "15") with SIGPIPE, and the drill died silently with exit 141.
version=$(pg_restore --version)
[[ $version =~ ([0-9]+)\. ]] || die "cannot read the pg_restore version from: $version"
major=${BASH_REMATCH[1]}
[ "$major" -ge 16 ] || die "pg_restore $major is too old: use 16 or newer (the dump was made by pg_dump 16)"

work=$(mktemp -d)
cleanup() { [ -n "$keep" ] || rm -rf "$work"; }
trap cleanup EXIT

if [ -n "$from_dir" ]; then
  cp "$from_dir/notefusion.dump" "$from_dir/manifest.json" "$work/"
  [ -f "$from_dir/globals.sql" ] && cp "$from_dir/globals.sql" "$work/"
else
  command -v restic >/dev/null || die "restic is not installed"
  if [ -z "${RESTIC_REPOSITORY:-}" ]; then
    missing=$(nf_missing_config | paste -sd ' ' -)
    [ -z "$missing" ] || die "set the backup settings first; empty: $missing"
    nf_export_tool_env
  fi
  if [ "$snapshot" = latest ]; then
    snapshot=$(restic -o s3.bucket-lookup=path snapshots --tag db --latest 1 --json | jq -r 'sort_by(.time) | last | .id // empty')
    [ -n "$snapshot" ] || die "no database dump found in $RESTIC_REPOSITORY"
  fi
  log "fetching dump ${snapshot:0:8} from $RESTIC_REPOSITORY"
  restic -o s3.bucket-lookup=path restore "$snapshot:/work/db" --target "$work" >/dev/null
fi
[ -n "$keep" ] && { mkdir -p "$keep"; work_keep=$keep; } || work_keep=""

manifest=$work/manifest.json
if [ ! -f "$work/notefusion.dump" ] || [ ! -f "$manifest" ]; then die "the snapshot has no notefusion.dump/manifest.json"; fi
want_sha=$(jq -r '.dump.sha256' "$manifest")
have_sha=$(sha256sum "$work/notefusion.dump" | cut -d' ' -f1)
[ "$want_sha" = "$have_sha" ] || die "the dump's SHA-256 does not match its manifest: corrupt download or tampering"
log "dump verified: $(jq -r '"\(.table_count) tables, \(.total_rows) rows, taken \(.source.snapshot_time) from PostgreSQL \(.source.server_version)"' "$manifest")"

psql_t() { psql "$target" -X -v ON_ERROR_STOP=1 -Atq "$@"; }
psql_t -c 'SELECT 1' >/dev/null || die "cannot connect to the target database"
existing=$(psql_t -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\_toast%'")
if [ "$existing" -gt 0 ] && [ "$allow_nonempty" != true ]; then
  die "the target already has $existing tables. Restore into an empty database (or pass --allow-nonempty)."
fi

if [ "$with_roles" = true ] && [ -f "$work/globals.sql" ]; then
  log "applying roles (globals.sql); errors for roles that already exist are expected"
  psql "$target" -X -q -f "$work/globals.sql" >/dev/null 2>"$work/globals.err" || true
  grep -v 'already exists' "$work/globals.err" >&2 || true
fi

log "restoring into $(psql_t -c "SELECT current_user || '@' || coalesce(host(inet_server_addr()), 'local') || '/' || current_database()")"
started=$(date -u +%s)
# --no-owner/--no-privileges: the objects become the target user's, which is what a managed provider
# allows and what the app expects. --exit-on-error: a half-restored database must not look like success.
pg_restore --no-owner --no-privileges --exit-on-error --jobs="$jobs" --dbname="$target" "$work/notefusion.dump"
log "pg_restore finished in $(( $(date -u +%s) - started ))s; comparing with the manifest"

# Count every table in the target the same way the dump counted the source.
psql_t >"$work/target-tables.json" <<'SQL'
SELECT coalesce(json_object_agg(t.name, t.n ORDER BY t.name), '{}')
FROM (
  SELECT format('%s.%s', n.nspname, c.relname) AS name,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS n
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
) t;
SQL
if [ "$(psql_t -c "SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL")" = t ]; then
  psql_t -c 'SELECT coalesce(json_agg("MigrationId" ORDER BY "MigrationId"), '"'[]'"') FROM "__EFMigrationsHistory"' >"$work/target-migrations.json"
else
  echo '[]' >"$work/target-migrations.json"
fi

jq -n --slurpfile m "$manifest" --slurpfile t "$work/target-tables.json" --slurpfile mig "$work/target-migrations.json" '
  ($m[0].tables) as $want | ($t[0]) as $have |
  {
    snapshot_time: $m[0].source.snapshot_time,
    tables_expected: ($want | length),
    tables_restored: ($have | length),
    rows_expected: ([$want[]] | add // 0),
    rows_restored: ([$have[]] | add // 0),
    missing_tables: [$want | keys[] | select($have[.] == null)],
    count_mismatches: [$want | to_entries[] | select($have[.key] != null and $have[.key] != .value)
                       | {table: .key, expected: .value, restored: $have[.key]}],
    migrations_expected: $m[0].ef_migrations.latest,
    migrations_restored: ($mig[0] | last),
    migrations_match: ($m[0].ef_migrations.applied == $mig[0])
  } | .ok = ((.missing_tables | length) == 0 and (.count_mismatches | length) == 0 and .migrations_match)
' >"$work/report.json"

[ -z "$report" ] || cp "$work/report.json" "$report"
[ -z "$work_keep" ] || cp "$work"/notefusion.dump "$manifest" "$work"/report.json "$work_keep"/ 2>/dev/null || true
jq -r '"tables: \(.tables_restored)/\(.tables_expected) · rows: \(.rows_restored)/\(.rows_expected) · EF migrations: \(.migrations_restored) (match: \(.migrations_match))"' "$work/report.json" >&2
if [ "$(jq -r '.ok' "$work/report.json")" != true ]; then
  jq '{missing_tables, count_mismatches, migrations_expected, migrations_restored}' "$work/report.json" >&2
  die "the restored database does NOT match the backup's manifest"
fi
log "OK: the restored database matches the manifest row for row"
