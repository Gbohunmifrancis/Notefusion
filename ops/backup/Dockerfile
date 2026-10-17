# The backup service (docker-compose.prod.yml `backup`, docs/BACKUP_AND_MIGRATION.md).
#
# Built on the very image the database runs, so pg_dump/pg_restore/psql and the server binaries are the
# same PostgreSQL 16 on the same C library (musl): a physical base backup restored with pitr-restore.sh
# starts here exactly as it would in the `db` container, and on the server the two images share their
# layers (no second copy of PostgreSQL on the small disk).
#
# Every tool is pinned and verified: release downloads by SHA-256 (ADD --checksum), wal-g by the git commit
# of its release tag, with its Go modules checked against go.sum. Bump a version by changing it and its
# checksum together; the build fails on any mismatch.
#   restic      0.18.1   encrypted, deduplicated repository (dumps, photos, the JWT key)
#   rclone      1.71.1   S3 → local photo mirror, status files, the optional second destination
#   wal-g       3.0.7    WAL archiving, base backups, point-in-time recovery (static, libsodium)
#   supercronic 0.2.34   the schedule (crontab)
ARG PG_IMAGE=postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
ARG GO_IMAGE=golang:1.24-alpine3.22@sha256:3641e0d9b931dc4f2f185dcd669c4679670e9277c8166a838ddb98a2d4389cb5

# ── wal-g, built static against musl ────────────────────────────────────────────────────────────────
# The release binaries are linked against glibc and do not run on Alpine; this one is static, so it also
# runs as is on any other Linux (copy it out of the image for a restore without Docker).
FROM ${GO_IMAGE} AS walg
ARG WALG_VERSION=v3.0.7
ARG WALG_COMMIT=6ea13b90a3198bd5c8f8ac2ae323f28e33cf9f06
RUN apk add --no-cache build-base libsodium-dev libsodium-static
ADD https://github.com/wal-g/wal-g.git#${WALG_COMMIT} /src
WORKDIR /src/main/pg
RUN CGO_ENABLED=1 GOFLAGS=-mod=mod go build -trimpath -tags libsodium -o /out/wal-g \
      -ldflags "-s -w -linkmode external -extldflags -static \
        -X github.com/wal-g/wal-g/cmd/pg.walgVersion=${WALG_VERSION} \
        -X github.com/wal-g/wal-g/cmd/pg.gitRevision=${WALG_COMMIT}" \
    && /out/wal-g --version

# ── release binaries, fetched and unpacked apart so the archives never become image layers ─────────
# (Build arguments are named *_RELEASE: rclone would read an RCLONE_VERSION variable as its --version flag.)
FROM ${PG_IMAGE} AS tools
ARG RESTIC_RELEASE=0.18.1
ARG RCLONE_RELEASE=1.71.1
ARG SUPERCRONIC_RELEASE=0.2.34
ADD --checksum=sha256:680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d \
    https://github.com/restic/restic/releases/download/v${RESTIC_RELEASE}/restic_${RESTIC_RELEASE}_linux_amd64.bz2 /tmp/restic.bz2
ADD --checksum=sha256:417e3da236f3a12d292da4e7287d67b1df558b8c2b280d092e563958ed724be7 \
    https://github.com/rclone/rclone/releases/download/v${RCLONE_RELEASE}/rclone-v${RCLONE_RELEASE}-linux-amd64.zip /tmp/rclone.zip
ADD --checksum=sha256:a51b340a83c5bd035742f0d7191555f9663876405e494dbf824537d64f3e39c6 \
    https://github.com/aptible/supercronic/releases/download/v${SUPERCRONIC_RELEASE}/supercronic-linux-amd64 /out/supercronic
RUN bunzip2 -c /tmp/restic.bz2 >/out/restic \
    && unzip -q -j /tmp/rclone.zip "rclone-v${RCLONE_RELEASE}-linux-amd64/rclone" -d /out \
    && chmod 0755 /out/*

# ── the backup image ────────────────────────────────────────────────────────────────────────────────
FROM ${PG_IMAGE}

RUN apk add --no-cache bash coreutils jq
COPY --from=tools /out/ /usr/local/bin/
COPY --from=walg /out/wal-g /usr/local/bin/wal-g
COPY scripts/ /usr/local/bin/
COPY restore.sh pitr-restore.sh restore-files.sh /usr/local/bin/
COPY crontab /etc/nf-backup/crontab
COPY db-role.sql drill-checks.sql /usr/local/share/nf-backup/
RUN chmod 0755 /usr/local/bin/nf-backup-* /usr/local/bin/*.sh && chmod 0644 /usr/local/bin/nf-backup-lib.sh \
    && mkdir -p /work \
    && wal-g --version && restic version && rclone version | head -1 && supercronic -version

ENV NF_WORK=/work \
    PGHOST=db \
    PGPORT=5432 \
    PGDATABASE=notefusion \
    PGUSER=notefusion_backup

WORKDIR /work
# Not the postgres image's entrypoint (which would start a server).
ENTRYPOINT []
CMD ["nf-backup-entrypoint"]
