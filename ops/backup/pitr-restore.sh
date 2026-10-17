#!/usr/bin/env bash
# Point-in-time recovery: rebuilds a data directory from a wal-g base backup plus the archived WAL, up to
# a moment you choose, runs the recovery to the end and leaves an ordinary, promoted PostgreSQL 16 data
# directory that the stock postgres:16-alpine image (the compose `db` service) starts as is.
#
#   pitr-restore.sh --data-dir DIR --target-time '2026-10-17 09:41:00+00'   (or --latest)
#     --data-dir DIR       an empty or missing directory to build into
#     --target-time TIME   recover up to this instant (the last transaction committed at or before it is
#                          kept; every one after is not). Write it with a UTC offset.
#     --latest             recover everything that was archived (for a lost server, not a bad change)
#     --backup NAME        start from this base backup (default: the newest one finished before the target)
#     --check-sql SQL      run once the database is open and print the result (the drill uses it)
#     --no-start           only fetch and configure; do not run the recovery here
#   PITR_SUPERUSER (default notefusion) is the restored cluster's superuser; PITR_TIMEOUT_SECONDS caps the wait.
#
# Run it inside the backup image, which has wal-g and the same PostgreSQL 16 (Alpine/musl) binaries as the
# production database. That matters: a physical backup only starts on the same major version and the same
# C library, because text indexes are sorted by it. To move to a different platform or provider, restore a
# logical dump instead (restore.sh), or recover here and then take a dump of the result.
#
#   docker run --rm -it --env-file backup.env -v notefusion-prod_db-data:/restore \
#     ghcr.io/gbohunmifrancis/notefusion-backup pitr-restore.sh --data-dir /restore --target-time '...'
set -Eeuo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for lib in "$here/nf-backup-lib.sh" "$here/scripts/nf-backup-lib.sh" /usr/local/bin/nf-backup-lib.sh; do
  # shellcheck source=scripts/nf-backup-lib.sh
  [ -f "$lib" ] && { . "$lib"; break; }
done
export NF_JOB=pitr

data="" target="" latest=false backup="" check_sql="" start=true
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) data=$2; shift 2 ;;
    --target-time) target=$2; shift 2 ;;
    --latest) latest=true; shift ;;
    --backup) backup=$2; shift 2 ;;
    --check-sql) check_sql=$2; shift 2 ;;
    --no-start) start=false; shift ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[ -n "$data" ] || die "--data-dir is required"
[ -n "$target" ] || [ "$latest" = true ] || die "give --target-time or --latest"
for tool in wal-g postgres pg_ctl psql jq; do command -v "$tool" >/dev/null || die "$tool is not installed (run this in the backup image)"; done

missing=$(nf_missing_config | paste -sd ' ' -)
[ -z "$missing" ] || die "set the backup settings first; empty: $missing"
nf_export_tool_env

mkdir -p "$data"
[ -z "$(ls -A "$data")" ] || die "$data is not empty. Recover into an empty directory (move the old one aside first)."

if [ -n "$target" ]; then
  # Normalised to UTC with microseconds, in the form recovery_target_time accepts.
  target_pg=$(date -u -d "$target" '+%Y-%m-%d %H:%M:%S.%6N+00') || die "cannot read the time '$target'"
  target_iso=$(date -u -d "$target" '+%Y-%m-%dT%H:%M:%S.%6NZ')
  target_epoch=$(date -u -d "$target" +%s)
fi

wal-g backup-list --detail --json >"/tmp/nf-pitr-backups.json"
if [ -z "$backup" ]; then
  if [ -n "$target" ]; then
    backup=$(jq -r --argjson t "$target_epoch" '[.[] | select((.finish_time | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) < $t)] | sort_by(.finish_time) | last | .backup_name // empty' /tmp/nf-pitr-backups.json)
    [ -n "$backup" ] || die "no base backup finished before $target_iso; the oldest kept is $(jq -r 'sort_by(.finish_time) | first | .finish_time' /tmp/nf-pitr-backups.json)"
  else
    backup=LATEST
  fi
fi
log "fetching base backup $backup into $data"
wal-g backup-fetch "$data" "$backup"

# Recovery settings, between markers so they can be taken out again once recovery is done.
{
  echo "# nf-pitr-begin"
  echo "restore_command = 'wal-g wal-fetch \"%f\" \"%p\"'"
  if [ -n "$target" ]; then
    echo "recovery_target_time = '$target_pg'"
    echo "recovery_target_inclusive = true"
  fi
  echo "recovery_target_action = 'promote'"
  echo "recovery_target_timeline = 'latest'"
  echo "# nf-pitr-end"
} >>"$data/postgresql.auto.conf"
touch "$data/recovery.signal"
if [ "$(id -u)" = 0 ]; then chown -R postgres:postgres "$data"; fi
chmod 0700 "$data"

# The cluster's own superuser (POSTGRES_USER when the compose stack created it).
su=${PITR_SUPERUSER:-notefusion}
as_pg() { if [ "$(id -u)" = 0 ]; then gosu postgres "$@"; else "$@"; fi; }

if [ "$start" != true ]; then
  log "configured; start PostgreSQL on $data with wal-g and the BACKUP_* settings available to finish recovery"
  exit 0
fi

sock=$(mktemp -d /tmp/nf-pitr-sock.XXXX)
if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$sock"; fi
logf=/tmp/nf-pitr-postgres.log
log "replaying WAL ${target:+up to $target_iso }(this can take a while)"
# Not reachable over the network while it recovers, and never archiving: a recovered copy must not
# write its new timeline into the production archive.
as_pg postgres -D "$data" -c listen_addresses='' -c unix_socket_directories="$sock" \
  -c archive_mode=off -c port=5432 >"$logf" 2>&1 &
pid=$!

deadline=$(( $(date +%s) + ${PITR_TIMEOUT_SECONDS:-7200} ))
while true; do
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 30 "$logf" >&2
    die "PostgreSQL stopped during recovery (see above). 'recovery ended before configured recovery target was reached' means the WAL archive does not reach that time."
  fi
  state=$(as_pg psql -h "$sock" -p 5432 -U "$su" -d postgres -XAtq -c 'SELECT pg_is_in_recovery()' 2>/dev/null || true)
  [ "$state" = f ] && break
  [ "$(date +%s)" -lt "$deadline" ] || { kill "$pid"; die "recovery did not finish within ${PITR_TIMEOUT_SECONDS:-7200}s"; }
  sleep 2
done

summary=$(as_pg psql -h "$sock" -p 5432 -U "$su" -d postgres -XAtq -c \
  "SELECT 'timeline ' || timeline_id || ', last replayed commit at ' || coalesce(pg_last_xact_replay_timestamp()::text, 'n/a') FROM pg_control_checkpoint()" 2>/dev/null || true)
grep -E 'recovery stopping|recovery target|redo done|selected new timeline|archive recovery complete' "$logf" | sed 's/^/  /' >&2 || true
log "recovered and promoted: $summary"
if [ -n "$check_sql" ]; then
  dbname=${PITR_CHECK_DB:-${PGDATABASE:-notefusion}}
  as_pg psql -h "$sock" -p 5432 -U "$su" -d "$dbname" -X -v ON_ERROR_STOP=1 -c "$check_sql"
fi

as_pg pg_ctl -D "$data" -m fast -w stop >/dev/null
sed -i '/# nf-pitr-begin/,/# nf-pitr-end/d' "$data/postgresql.auto.conf"

# Promotion wrote the new timeline's history file, but archiving was off here, so nothing marked it for
# the archive. Without it in the bucket a later recovery cannot follow this timeline switch. Mark it (and
# any other history file not yet archived) ready: the db service archives it on its first start. A copy
# that is only read from, never started as the database, pushes nothing.
for h in "$data"/pg_wal/*.history; do
  [ -e "$h" ] || continue
  name=$(basename "$h")
  [ -e "$data/pg_wal/archive_status/$name.done" ] || as_pg touch "$data/pg_wal/archive_status/$name.ready"
done
if [ -n "$target" ]; then upto="to $target_iso"; else upto="to the end of the archive"; fi
log "done. $data is a normal PostgreSQL 16 data directory, recovered $upto."
log "next: docs/BACKUP_AND_MIGRATION.md, Restoring, A: use it as the db volume and start the stack."
