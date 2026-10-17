#!/usr/bin/env bash
# Brings back what lives outside the database: the profile photos, the JWT signing key, the Caddyfile and
# the list of settings the server had.
#
#   restore-files.sh --out DIR [--snapshot ID|latest] [--avatars-to DEST]
#     --out DIR          where to put the files (created). You get:
#                          DIR/avatars/...                 every profile photo, as stored in the bucket
#                          DIR/jwt_private_key.pem         the JWT signing key (0600)
#                          DIR/Caddyfile, DIR/env-names.txt
#     --avatars-to DEST  also upload the photos to any S3-compatible bucket, as an rclone destination:
#                          a configured remote ("r2new:notefusion-avatars"), or a connection string:
#                          ":s3,provider=Cloudflare,endpoint='https://<acct>.r2.cloudflarestorage.com',access_key_id=..,secret_access_key=..:bucket"
#                        (a value with a colon in it, like the endpoint, goes in single quotes)
#
# Then: put jwt_private_key.pem back as /opt/notefusion/jwt_private_key.pem (or the JWT_PRIVATE_KEY_PEM
# secret) so every signed-in user stays signed in and web push keeps working.
set -Eeuo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for lib in "$here/nf-backup-lib.sh" "$here/scripts/nf-backup-lib.sh" /usr/local/bin/nf-backup-lib.sh; do
  # shellcheck source=scripts/nf-backup-lib.sh
  [ -f "$lib" ] && { . "$lib"; break; }
done
export NF_JOB=restore-files

out="" snapshot=latest dest=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --snapshot) snapshot=$2; shift 2 ;;
    --avatars-to) dest=$2; shift 2 ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[ -n "$out" ] || die "--out is required"
for tool in restic jq; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
[ -z "$dest" ] || command -v rclone >/dev/null || die "rclone is not installed"
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  missing=$(nf_missing_config | paste -sd ' ' -)
  [ -z "$missing" ] || die "set the backup settings first; empty: $missing"
  nf_export_tool_env
fi

if [ "$snapshot" = latest ]; then
  snapshot=$(restic -o s3.bucket-lookup=path snapshots --tag files --latest 1 --json | jq -r 'sort_by(.time) | last | .id // empty')
  [ -n "$snapshot" ] || die "no files snapshot found in $RESTIC_REPOSITORY"
fi

mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log "restoring files snapshot ${snapshot:0:8}"
restic -o s3.bucket-lookup=path restore "$snapshot" --target "$tmp" >/dev/null

if [ -d "$tmp/work/files/avatars" ]; then
  rm -rf "$out/avatars"
  mv "$tmp/work/files/avatars" "$out/avatars"
fi
for f in jwt_private_key.pem Caddyfile env-names.txt; do
  if [ -f "$tmp/run/host/$f" ]; then
    mv "$tmp/run/host/$f" "$out/$f"
  else
    log "warning: $f is not in this snapshot"
  fi
done
[ -f "$out/jwt_private_key.pem" ] && chmod 0600 "$out/jwt_private_key.pem"

photos=$(find "$out/avatars" -type f 2>/dev/null | wc -l)
log "restored to $out: $photos photos$([ -f "$out/jwt_private_key.pem" ] && echo ', the JWT key')"

if [ -n "$dest" ]; then
  log "uploading the photos to $(sed -E 's/(key|secret_access_key|access_key_id|account)=[^,:]*/\1=***/g' <<<"$dest")"
  rclone copy "$out/avatars" "$dest" --transfers 8 --checkers 16 --s3-no-check-bucket
  log "photos uploaded. If the bucket's public address changed, set R2__PublicBaseUrl and run the SQL in docs/BACKUP_AND_MIGRATION.md to rewrite the stored photo URLs."
fi
