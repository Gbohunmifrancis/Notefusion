# shellcheck shell=bash
# Shared by every backup job and every restore script (sourced, never run).
#
# The deployment sets five provider-neutral settings and nothing tool-specific:
#   BACKUP_S3_ENDPOINT          https://<account>.r2.cloudflarestorage.com (any S3-compatible endpoint)
#   BACKUP_S3_BUCKET            notefusion-backups
#   BACKUP_S3_ACCESS_KEY_ID     a key scoped to that bucket alone
#   BACKUP_S3_SECRET_ACCESS_KEY
#   BACKUP_ENCRYPTION_PASSWORD  encrypts everything client-side; lose it and the backups are unreadable
# optional: BACKUP_S3_REGION (default "auto", which R2 wants; AWS wants the bucket's region).
# nf_export_tool_env turns those into what restic, wal-g and rclone each read, so moving to another
# provider is a change of endpoint and keys, never of tooling.
#
# Bucket layout:  restic/  encrypted restic repository (logical dumps, avatars, the JWT key)
#                 wal-g/   encrypted base backups and WAL (point-in-time recovery)
#                 status/  the restore drill's last result (JSON, no secrets)

# Everything written here (the dump on its way to the bucket, restored files) is for this user alone.
umask 077

NF_WORK=${NF_WORK:-/work}
NF_STATE=${NF_STATE:-$NF_WORK/state}
NF_SPOOL=${NF_SPOOL:-/var/lib/postgresql/wal-spool}
NF_PGDATA=${NF_PGDATA:-/var/lib/postgresql/data}

nf_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '%s [%s] %s\n' "$(nf_now)" "${NF_JOB:-backup}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Names of the required settings that are empty, one per line (nothing when complete).
nf_missing_config() {
  local v
  for v in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PASSWORD; do
    [ -n "${!v:-}" ] || printf '%s\n' "$v"
  done
}

# WAL-G encrypts with a 32-byte libsodium key. It is derived from the one password so there is a single
# secret to keep; the "v1" label lets a future rotation derive a different key from the same password.
nf_walg_key() { printf 'notefusion/wal-g/v1:%s' "$BACKUP_ENCRYPTION_PASSWORD" | sha256sum | cut -d' ' -f1; }

nf_export_tool_env() {
  local endpoint=${BACKUP_S3_ENDPOINT%/}
  local region=${BACKUP_S3_REGION:-auto}

  export AWS_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID
  export AWS_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY
  export AWS_DEFAULT_REGION=$region AWS_REGION=$region

  # restic
  export RESTIC_REPOSITORY=${RESTIC_REPOSITORY:-s3:$endpoint/$BACKUP_S3_BUCKET/restic}
  export RESTIC_PASSWORD=$BACKUP_ENCRYPTION_PASSWORD
  export RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-$NF_WORK/cache/restic}
  export RESTIC_COMPRESSION=${RESTIC_COMPRESSION:-auto}

  # wal-g (S3 settings plus encryption; it reads the PG* variables for its database connection)
  export WALG_S3_PREFIX=${WALG_S3_PREFIX:-s3://$BACKUP_S3_BUCKET/wal-g}
  export AWS_ENDPOINT=$endpoint AWS_S3_FORCE_PATH_STYLE=true
  WALG_LIBSODIUM_KEY=$(nf_walg_key)
  export WALG_LIBSODIUM_KEY WALG_LIBSODIUM_KEY_TRANSFORM=hex
  export WALG_COMPRESSION_METHOD=${WALG_COMPRESSION_METHOD:-zstd}
  # A segment pushed twice (a crash between upload and spool clean-up) is compared, not overwritten:
  # an overwrite would also be refused by an R2 bucket lock.
  export WALG_PREVENT_WAL_OVERWRITE=true
  # Small box: few parallel uploads, so a base backup never competes hard with transcriptions.
  export WALG_UPLOAD_CONCURRENCY=${WALG_UPLOAD_CONCURRENCY:-2}
  export WALG_DOWNLOAD_CONCURRENCY=${WALG_DOWNLOAD_CONCURRENCY:-4}
  export WALG_UPLOAD_DISK_CONCURRENCY=${WALG_UPLOAD_DISK_CONCURRENCY:-1}

  # rclone remote "backup:" — the same bucket, for the status files and the optional mirror.
  export RCLONE_CONFIG_BACKUP_TYPE=s3
  export RCLONE_CONFIG_BACKUP_PROVIDER=Other
  export RCLONE_CONFIG_BACKUP_ENDPOINT=$endpoint
  export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID
  export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY
  export RCLONE_CONFIG_BACKUP_REGION=$region
  export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=true
  # A token scoped to one bucket may not list or create buckets.
  export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

  # rclone remote "files:" — the avatars bucket, read with the API's own photo credentials.
  if [ -n "${FILES_S3_BUCKET:-}" ]; then
    export RCLONE_CONFIG_FILES_TYPE=s3
    export RCLONE_CONFIG_FILES_PROVIDER=Other
    export RCLONE_CONFIG_FILES_ENDPOINT=${FILES_S3_ENDPOINT%/}
    export RCLONE_CONFIG_FILES_ACCESS_KEY_ID=${FILES_S3_ACCESS_KEY_ID:-}
    export RCLONE_CONFIG_FILES_SECRET_ACCESS_KEY=${FILES_S3_SECRET_ACCESS_KEY:-}
    export RCLONE_CONFIG_FILES_REGION=${FILES_S3_REGION:-auto}
    export RCLONE_CONFIG_FILES_FORCE_PATH_STYLE=true
    export RCLONE_CONFIG_FILES_NO_CHECK_BUCKET=true
  fi
}

# restic, with path-style bucket addressing (every S3-compatible store supports it).
nf_restic() { restic -o s3.bucket-lookup=path "$@"; }

# Records one run in the backup_runs table the admin console reads. Never fails the caller: a status row
# that cannot be written is logged, and the backup itself stands or falls on its own.
#   nf_record KIND OK(true|false) STARTED FINISHED [SIZE_BYTES] [VERIFIED(true|false)] [WAL_ARCHIVED_AT] [DETAIL]
nf_record() {
  local kind=$1 ok=$2 started=$3 finished=$4 size=${5:-} verified=${6:-false} walat=${7:-} detail=${8:-}
  if ! psql -X -q -v ON_ERROR_STOP=1 \
      -v kind="$kind" -v ok="$ok" -v started="$started" -v finished="$finished" \
      -v size="$size" -v verified="$verified" -v walat="$walat" -v detail="$detail" >/dev/null 2>"$NF_STATE/record.err" <<'SQL'
INSERT INTO backup_runs ("Kind", "Ok", "StartedAtUtc", "FinishedAtUtc", "SizeBytes", "Verified", "WalArchivedAtUtc", "Detail")
VALUES (:'kind', :'ok'::boolean, :'started'::timestamptz, :'finished'::timestamptz,
        NULLIF(:'size', '')::bigint, :'verified'::boolean, NULLIF(:'walat', '')::timestamptz,
        NULLIF(left(:'detail', 2000), ''));
SQL
  then
    log "could not record the $kind run in backup_runs: $(tr '\n' ' ' < "$NF_STATE/record.err")"
  fi
}

nf_human_bytes() { numfmt --to=iec --suffix=B "${1:-0}" 2>/dev/null || printf '%sB' "${1:-0}"; }

# Free bytes on the filesystem holding a path.
nf_free_bytes() { df -Pk "$1" | awk 'NR == 2 { print $4 * 1024 }'; }
