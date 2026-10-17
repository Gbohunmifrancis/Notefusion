# Backups, restores and moving to another cloud

Everything NoteFusion cannot afford to lose is copied, encrypted, off the server, every few minutes to
every day, into a bucket of its own — Cloudflare R2 today, any S3-compatible store tomorrow. Every copy
restores with free, standard tools (PostgreSQL's `pg_restore`, restic, rclone, wal-g) onto **any**
PostgreSQL 16 or newer and any S3-compatible storage. Nothing in the restore path depends on AWS or
Cloudflare.

This page is written to be followed step by step. Commands run on the server in `/opt/notefusion`
unless it says otherwise.

---

## In one minute

| What | How | How often | Kept for | Worst-case loss (RPO) |
|---|---|---|---|---|
| The whole database, portable | `pg_dump` (custom format) + roles, encrypted (restic) | every 6 h (00:17, 06:17, 12:17, 18:17 UTC) | every dump 2 days, then 1/day 14 days, 1/week 8 weeks, 1/month 12 months | 6 hours |
| The database, minute by minute | WAL-G: a base backup daily (02:37 UTC) + every WAL segment as it fills, at least once a minute | continuous | 8 days of points in time | about 1–2 minutes |
| Profile photos | rclone mirror of the photo bucket, versioned in restic | daily (03:47 UTC) | 30 daily, 8 weekly, 12 monthly versions | 1 day |
| JWT signing key, Caddyfile, list of settings | restic | daily, and the key is also a GitHub secret | as photos | none (the key never changes) |
| Proof that it all restores | restore drill in GitHub Actions | weekly (Sunday 04:41 UTC) | — | — |

**How long a restore takes (RTO):** the logical restore of today's database takes minutes (it is small);
a whole new server, from nothing to serving users, is about an hour, most of it creating the machine
and waiting for DNS. Point-in-time recovery adds the time to replay a day of WAL: minutes.

**Where things live:** the bucket `notefusion-backups` (separate from the photo bucket, with its own key):

```
notefusion-backups/
  restic/   the encrypted restic repository: database dumps, photos, the JWT key, settings list
  wal-g/    encrypted base backups + WAL (point-in-time recovery)
  status/   restore-drill.json, the last drill's result (no secrets)
```

**Status:** the admin console's **System Health** page has a **Backups** card ("Last database backup:
3 h ago · 412 MB · verified", "WAL archived: just now", "Last restore drill: Passed Sunday"). If no
verified dump has been made for 26 hours, WAL archiving falls more than 15 minutes behind (or goes
quiet), a daily job is late or fails, or the drill fails, every admin gets a push and an email; it
repeats once a day while anything is still wrong, and a push says when it is fixed.

---

## What is backed up, and what is not

**Backed up**

- **PostgreSQL 16** (`db` service, `db-data` volume): every table — accounts, payments and the ledger,
  subscriptions and choirs, transcription jobs and their results, saved sheets, the blog (it lives in
  the database), analytics, push subscriptions, passkeys, the audit log — plus the roles (without their
  password hashes; the app's password is the `POSTGRES_PASSWORD` secret).
- **Profile photos** (the R2 photo bucket, `R2__BucketName`): the whole bucket.
- **`jwt_private_key.pem`**: signs every login; the web-push keys and the account-deletion secret are
  derived from it. Losing it signs everyone out and breaks web push. Stored encrypted in restic, and it
  is also the `JWT_PRIVATE_KEY_PEM` GitHub secret.
- **The Caddyfile** (it lives only on the server) and **`env-names.txt`**: the name of every setting
  in the server's `.env` and whether it is set — never a value.

**Deliberately not backed up**

- **The worker's job journal** (`job-data`): it holds users' uploaded audio for the minutes a job runs,
  and we promise audio is deleted after each job. A restore loses at most the jobs running at that
  moment; the API's sweep closes them without charging anyone.
- **`caddy-data`** (TLS certificates): Caddy fetches new ones by itself. **`dozzle-data`**: log viewer.
- **Secrets**: they live in GitHub (Settings → Secrets and variables → Actions) and are written to the
  server by the deploy. GitHub is not part of AWS or Cloudflare, so losing either does not lose them.
  Keep your own copy of the few that cannot be fetched again (see "The password" below).

---

## How it works

```
 db (postgres:16-alpine)                   backup (ghcr.io/…/notefusion-backup, lowest CPU/IO priority)
 ├─ archive_command: gzip each finished      ├─ every 20 s  wal-push: spool → wal-g → bucket wal-g/
 │  WAL segment into the wal-spool volume ──►├─ every 6 h   dump: pg_dump → verify → restic → read back
 │  (archive_timeout=60: at least 1/min)     ├─ daily       base: wal-g backup-push (reads db-data, read-only)
 └─ db-data volume ─────── read-only ───────►├─ daily       files: photos + JWT key + Caddyfile → restic
                                             ├─ daily       maintain: retention + restic check (5% re-read)
                                             ├─ daily       mirror: restic repo → second provider (optional)
                                             └─ hourly      drill-status: status/restore-drill.json → console
```

- **Tools (pinned, verified at build):** restic 0.18.1, rclone 1.71.1 and supercronic 0.2.34 by SHA-256;
  wal-g 3.0.7 built from its release commit (static, so it runs on Alpine and on Ubuntu); PostgreSQL
  16.15 client and server tools from the very image the database runs. See `ops/backup/Dockerfile`.
- **Why WAL-G (not pgBackRest):** one small static binary, S3 is its native home, it is configured by a
  few environment variables, and it encrypts client-side. pgBackRest is excellent but wants a config file,
  a repository host or local spool, and more care on a one-box server with an 8 GB disk.
- **Why restic (not age + plain files):** encryption, deduplication (four dumps a day cost little more than
  one), retention policies, and a built-in integrity check (`restic check --read-data-subset`) in one
  tool that talks to S3, B2, Google Cloud, Azure, SFTP and a plain folder. Plain encrypted files would
  need all of that written by hand.
- **Encryption:** everything is encrypted on the server before it leaves, with one password
  (`BACKUP_ENCRYPTION_PASSWORD`). restic uses it directly; WAL-G uses a key derived from it
  (`sha256("notefusion/wal-g/v1:" + password)`), so there is still only one secret to keep.
- **Verification, every time:** a dump is checked by `pg_restore --list` and against the row counts
  taken in the same snapshot, uploaded, then **read back out of the bucket and compared by SHA-256**
  before it counts as "verified". The daily check re-reads 5% of the repository (all of it every few
  weeks). The weekly drill restores it for real.
- **The manifest:** each dump carries `manifest.json` — the exact row count of every table at the
  dump's snapshot, the dump's size and SHA-256, the PostgreSQL version, the encoding and collation, and
  every EF migration applied. A restore is compared with it row for row.
- **Safety for the small disk:** the database only gzips finished WAL into the spool. If the backup
  service is not running yet, or the bucket is unreachable long enough for the spool to reach
  `NF_WAL_SPOOL_MAX_MB` (1 GB), the database lets the segment go instead of filling the disk, and the
  console says "WAL archiving is behind or interrupted" until the next base backup closes the gap.
- **Least privilege:** the backup container logs in as `notefusion_backup`, which can read everything,
  run a base backup and add rows to `backup_runs` — nothing else. It never sees the database superuser's
  password (the deploy derives its own). Its bucket key reaches the backup bucket only; the photo bucket
  is read with the API's existing photo key.
- **Missing settings:** the service logs which are missing, shows "Not set up" in the console, keeps the
  WAL spool empty and waits. It never crash-loops and never holds up a deploy.

---

## Setting it up

You do this once. Allow 30 minutes.

### 1. Create the backup bucket (Cloudflare dashboard)

1. **R2 Object Storage → Create bucket.** Name: `notefusion-backups`. Location: Automatic (or the region
   nearest the server). Default storage class: Standard. **Create bucket.**
2. Leave **Public access** off. Nothing in this bucket is ever served to anyone.

### 2. Create a key for that bucket only

1. **R2 Object Storage → Manage API tokens → Create API token** (an *Account* token is fine).
2. Name: `notefusion-backups-server`. Permissions: **Object Read & Write**.
   **Specify bucket(s): Apply to specific buckets only → `notefusion-backups`.** TTL: Forever.
3. **Create.** Copy the **Access Key ID**, the **Secret Access Key** (shown once) and the **S3 endpoint**
   (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, without the bucket name).

Never reuse the photo bucket's key (`R2__*`) here, and never give this key to the API.

### 3. Make the encryption password — and keep it in two places that are not AWS or Cloudflare

```bash
openssl rand -hex 32        # 64 letters and digits; use this as BACKUP_ENCRYPTION_PASSWORD
```

Use letters and digits only (no quotes or `$`): the deploy writes it into a quoted `.env` line.

> **This password is the only way to read the backups.** If the server, the bucket's provider and GitHub
> all disappeared, the backups are still yours — but only with this password. Put it in your password
> manager (1Password, Bitwarden…), in an entry called "NoteFusion backups", together with: the bucket
> name, the endpoint, the Access Key ID and Secret, and (if you set one up) the mirror's details. Then
> keep a second copy somewhere physical and safe (printed, in a safe or with someone you trust). Do not
> store it in AWS (Secrets Manager, SSM, the EC2 box) or in Cloudflare — those are what it protects you
> from losing. It also goes into GitHub as a secret (next step); that copy is for the server, not your
> recovery copy.

### 4. Add the settings to GitHub

GitHub → the repository → **Settings → Secrets and variables → Actions**:

| Name | Kind | Value |
|---|---|---|
| `BACKUP_S3_ENDPOINT` | variable (or secret) | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET` | variable (or secret) | `notefusion-backups` |
| `BACKUP_S3_ACCESS_KEY_ID` | **secret** | from step 2 |
| `BACKUP_S3_SECRET_ACCESS_KEY` | **secret** | from step 2 |
| `BACKUP_ENCRYPTION_PASSWORD` | **secret** | from step 3 |
| `BACKUP_S3_REGION` | variable, optional | leave unset for R2 (`auto`); the bucket's region on AWS S3 |
| `BACKUP_MIRROR` | secret, optional | the second destination (step 7) |

The deploy and the weekly restore drill both read these.

### 5. Lock the point-in-time history so a hacked server cannot erase it (R2 bucket lock)

R2 has no "delete but keep a copy" versioning; its protection is a **bucket lock rule**, which refuses
every delete or overwrite of matching objects until they are old enough.

1. **R2 Object Storage → `notefusion-backups` → Settings → Bucket lock rules → Add rule.**
2. Rule name `wal-g-7-days`. Prefix: `wal-g/`. Retention: **7 days**. **Save.**

Why only `wal-g/`, and why 7 days: WAL-G keeps 8 days of base backups and only ever deletes objects older
than that, so a 7-day lock never gets in its way — while anyone holding the server's key (an attacker
included) cannot delete the last week of point-in-time history. The `restic/` prefix is **not** locked:
restic's clean-up (`prune`) has to rewrite its own index files, and a lock would make every clean-up
fail. The protection for the dumps against a hacked server is the second copy (step 7), whose key cannot
delete.

### 6. Deploy

GitHub → **Actions → Deploy to EC2 → Run workflow** (on `main`) — ideally at a quiet hour, because of
the one-time switch-over below. The deploy builds and pushes the backup image, creates the
`notefusion_backup` database login, restarts the database once, and starts the backup service.

Then check, on the server:

```bash
cd /opt/notefusion      # the compose file lives here, not in your home folder
docker compose -f docker-compose.prod.yml logs --tail 20 backup
#   [startup] Backups are ON: notefusion-backups at <account>.r2.cloudflarestorage.com; schedule …

# Take the first dump and base backup now instead of waiting for the schedule:
docker compose -f docker-compose.prod.yml exec backup nf-backup-run dump
docker compose -f docker-compose.prod.yml exec backup nf-backup-run base
docker compose -f docker-compose.prod.yml exec backup nf-backup-run files
```

The console's System Health → Backups card should say "Healthy" once the first file backup and
repository check have run (the check runs at 04:07 UTC; or run `nf-backup-run maintain` now).

Finally, **Actions → Backup restore drill → Run workflow** once, and watch it pass.

### 7. Optional, recommended: a second copy at another company

The backups and the server must not all depend on one company. Setting `BACKUP_MIRROR` copies the
restic repository (dumps, photos, JWT key) once a day to any rclone destination. It only ever adds
files, never deletes, so with a key that **cannot delete** the server cannot erase it.

Backblaze B2 example (any S3-compatible store, Google Drive or SFTP also works):

1. Create a private bucket, e.g. `notefusion-backup-mirror`. In its **Lifecycle settings** choose
   **Keep all versions of the file**; optionally enable **Object Lock** with a default retention of 30 days.
2. Create an application key that can write but not delete. B2's web form only offers read/write; the
   command line gives exact capabilities:
   `b2 key create --bucket notefusion-backup-mirror notefusion-mirror listBuckets,listFiles,readFiles,writeFiles`
3. Set the secret `BACKUP_MIRROR` to
   `:b2,account=<keyID>,key=<applicationKey>:notefusion-backup-mirror/restic`
   (for an S3-compatible store: `:s3,provider=Other,endpoint='https://s3.example.com',access_key_id=…,secret_access_key=…:bucket/restic`
   — a value with a colon in it goes in single quotes). Redeploy.
4. Add these details to the password-manager entry.

The mirror is a complete restic repository: the same password opens it (see "If R2 itself is gone").
Because it never deletes, it grows; prune it by hand once a year with a key that can delete if the bill
matters (`restic -r <mirror> forget --keep-monthly 24 --prune`).

---

## The one-time switch-over to WAL archiving

What changes: the `db` service gets three settings (`archive_mode=on`, `archive_timeout=60`, an
`archive_command` that gzips into the new `wal-spool` volume) and its image is pinned to the exact
PostgreSQL 16.15/Alpine 3.24 build the backup image uses. `archive_mode` can only change on a restart,
so the first deploy with this change **restarts the database once** — a few seconds in which the API
answers errors and retries. The data volume is untouched: same image family (Alpine, so the musl-sorted
text indexes stay valid), same major version, same files. Nothing needs converting.

If you prefer to do it by hand at a quiet moment rather than at deploy time:

```bash
cd /opt/notefusion
docker compose -f docker-compose.prod.yml up -d --no-deps db       # recreates db with the new settings
docker compose -f docker-compose.prod.yml exec db psql -U notefusion -d notefusion \
  -c "SHOW archive_mode" -c "SELECT pg_switch_wal()" -c "SELECT * FROM pg_stat_archiver"
```

`archived_count` should rise and `failed_count` stay 0 (the command never fails by design). To undo,
remove the `command:` block from the `db` service and recreate it the same way.

---

## Restoring

All the tools are in the backup image, so any machine with Docker can restore. Put the settings in a
file first (on your laptop, a new server or the old one) — **values unquoted**:

```bash
cat > backup.env <<'EOF'
BACKUP_S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=notefusion-backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_ENCRYPTION_PASSWORD=...
EOF
chmod 600 backup.env
IMG=ghcr.io/gbohunmifrancis/notefusion-backup:latest   # private: `docker login ghcr.io` with a GitHub
                                                      # token that has read:packages, or build it:
                                                      # docker build -t nf-backup ops/backup && IMG=nf-backup
docker run --rm --env-file backup.env $IMG nf-backup-env restic snapshots      # what is there
docker run --rm --env-file backup.env $IMG nf-backup-env wal-g backup-list     # base backups
```

On the production server you can skip the file: `docker compose -f docker-compose.prod.yml exec backup …`
has the settings already.

Without Docker: install restic, PostgreSQL 16 client tools and jq, export the same five variables, and
run `ops/backup/restore.sh` from a checkout of this repository. Nothing else is needed.

### A. "Someone deleted rows" or "a migration broke data" → point-in-time recovery

Pick the moment just before it happened, in UTC (the API logs and the admin audit log have times).

**Just get the rows back (no downtime):** rebuild a copy beside production, then copy what you need out.

```bash
docker volume create nf-pitr
docker run --rm --env-file backup.env -v nf-pitr:/restore $IMG \
  pitr-restore.sh --data-dir /restore/pgdata --target-time '2026-10-17 09:41:00+00'
# start the copy and take what you need from it
docker run -d --name nf-pitr-db -e PGDATA=/var/lib/postgresql/data/pgdata -v nf-pitr:/var/lib/postgresql/data \
  postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea
docker exec nf-pitr-db pg_dump -U notefusion -d notefusion --data-only -t transcriptions > rows.sql
# …review rows.sql, load the part you need into production with psql, then:
docker rm -f nf-pitr-db && docker volume rm nf-pitr
```

**Put the whole database back to that moment** (everything written after it is lost, so only for a
disaster). On the server, where the backup service already has its settings:

```bash
cd /opt/notefusion
DC="docker compose -f docker-compose.prod.yml"
$DC stop api backup db
# Keep today's data aside until you are sure (needs as much free disk as the database).
docker volume create notefusion-prod_db-data-before-pitr
$DC run --rm --no-deps -v notefusion-prod_db-data-before-pitr:/aside -v notefusion-prod_db-data:/restore backup \
  sh -c 'cp -a /restore/. /aside/ && find /restore -mindepth 1 -delete'
$DC run --rm --no-deps -v notefusion-prod_db-data:/restore backup \
  pitr-restore.sh --data-dir /restore --target-time '2026-10-17 09:41:00+00'
$DC up -d db api backup
# Days later, when all is well:  docker volume rm notefusion-prod_db-data-before-pitr
```

`pitr-restore.sh` replays the archive up to that instant, promotes the copy and checks it opens; the
result is an ordinary data directory the normal `db` service starts. If it says *"recovery ended before
configured recovery target was reached"*, the archive does not reach that time (pick an earlier one).
A recovered database starts a new timeline; WAL-G handles that in the same `wal-g/` prefix.

Physical backups only start on **PostgreSQL 16 on Alpine (musl)** — the backup image or the `db`
service. To move to another platform, use a logical dump (B), or recover here and dump the result.

### B. "The server is gone" → a new server, anywhere

1. Make a new Linux machine with Docker (any provider). Follow `EC2_MIGRATION_GUIDE.md` steps 1 and 3
   with its address in `EC2_HOST` / `EC2_USER` / `EC2_SSH_KEY`. All other secrets stay as they are.
2. **Actions → Deploy to EC2 → Run workflow.** This starts an empty database, which the API migrates.
3. Restore the newest dump into it (on the new server):
   ```bash
   cd /opt/notefusion
   docker compose -f docker-compose.prod.yml stop api backup
   docker compose -f docker-compose.prod.yml exec db psql -U notefusion -d postgres \
     -c "DROP DATABASE notefusion" -c "CREATE DATABASE notefusion OWNER notefusion"
   docker compose -f docker-compose.prod.yml run --rm --no-deps backup \
     restore.sh --target-url "postgres://notefusion:$(grep ^POSTGRES_PASSWORD= .env | cut -d'"' -f2)@db:5432/notefusion"
   ```
   It must end with **"OK: the restored database matches the manifest row for row"**.
   For minute-level recovery instead (the newest WAL, not the 6-hourly dump), restore with
   `pitr-restore.sh --latest` into the `db-data` volume as in A.
4. Re-run the deploy (it re-creates the backup login and grants), then
   `docker compose -f docker-compose.prod.yml up -d api backup`.
5. **New WAL-G prefix:** a database restored from a dump is a new cluster; its WAL must not land in the
   old one's folder. Set the repository variable `BACKUP_WALG_PREFIX` to e.g.
   `s3://notefusion-backups/wal-g-2026-10` and deploy once more. (Not needed after a PITR restore.)
6. The JWT key comes from the `JWT_PRIVATE_KEY_PEM` secret, so everyone stays signed in. If that
   secret were lost too: `restore-files.sh` (E) gives it back — paste it into the secret and redeploy.
7. Photos are in R2 and untouched. Point DNS at the new address if it changed.

### C. "R2 (Cloudflare) itself is gone"

The server still has the live database, so first take a dump somewhere else — set the `BACKUP_*`
settings to a new S3-compatible bucket (Backblaze B2, Wasabi, AWS S3, Google Cloud Storage in
interoperability mode, MinIO…) and redeploy: the service creates a fresh repository there and backs up
within six hours (`nf-backup-run dump` to do it now). Set `BACKUP_WALG_PREFIX` to a new value too.

If the server is gone **as well**, restore from the mirror (step 7), which is a complete restic repository:

```bash
docker run --rm -it --env-file backup.env \
  -e RESTIC_REPOSITORY='rclone::b2,account=<keyID>,key=<appKey>:notefusion-backup-mirror/restic' \
  -e RESTIC_PASSWORD="<the password>" $IMG \
  restore.sh --target-url postgres://USER:PASS@HOST:5432/notefusion
```

(Any rclone destination works the same way after `rclone::`.) Without a mirror the backups had only one
home; that is the reason to set one up.

### D. Restore into a managed database (RDS, Cloud SQL, Azure, Neon, Supabase)

Create an empty database and a user that owns it, then:

```bash
docker run --rm --env-file backup.env $IMG \
  restore.sh --target-url 'postgres://USER:PASS@HOST:5432/notefusion?sslmode=require'
```

`restore.sh` uses `--no-owner --no-privileges`, so everything becomes that user's, which managed
services allow. Roles (`globals.sql`) are skipped unless you pass `--with-roles` (they need a
superuser, which managed services do not give; the app does not need them). There, point-in-time
recovery is the provider's: run the backup service with `BACKUP_PHYSICAL=off` and
`PGHOST`/`PGUSER`/`PGPASSWORD` pointing at the managed database, and the 6-hourly portable dumps carry on.

### E. Photos and the JWT key

```bash
docker run --rm --env-file backup.env -v "$PWD/restored:/out" $IMG restore-files.sh --out /out \
  --avatars-to ":s3,provider=Cloudflare,endpoint='https://<ACCOUNT_ID>.r2.cloudflarestorage.com',access_key_id=…,secret_access_key=…:notefusion-avatars"
```

You get `restored/avatars/…`, `restored/jwt_private_key.pem`, `restored/Caddyfile` and
`restored/env-names.txt`. If the photos' public address changes, update the `R2__PUBLICBASEURL` secret
(the API's `R2__PublicBaseUrl`) and rewrite the stored links once:

```sql
UPDATE users SET "ProfilePictureUrl" = replace("ProfilePictureUrl", 'https://old-photos.example', 'https://new-photos.example')
WHERE "ProfilePictureUrl" LIKE 'https://old-photos.example/%';
```

### After any restore

```bash
docker run --rm --network host -v "$PWD/ops/backup/drill-checks.sql:/c.sql:ro" $IMG \
  psql "postgres://USER:PASS@HOST:5432/notefusion" -v ON_ERROR_STOP=1 -f /c.sql
```

checks every foreign key, the ledger against its payments, and that an admin exists.

---

## Moving to another cloud without losing anything

The idea: rehearse with a copy while everything keeps running, then stop writes for a few minutes, take
one last backup, restore it at the new home, check it row for row, and move the address.

**A day before**

1. At the new provider, create: a PostgreSQL 16+ database (managed, or a VM running this compose stack),
   a machine with Docker for the API and worker (or the VM itself), and — only if the photos move too —
   an S3-compatible bucket.
2. Lower the TTL of the DNS records (`api.notefusion.studio` and any other the app uses) to 300 seconds.
3. **Rehearse:** restore the latest dump into the new database (`restore.sh`, as in D). Note how long it
   takes; that is the length of the real switch. Drop and re-create the database afterwards.
4. Prepare the new server's settings: every secret and variable in the list below, with `Database__*`
   pointing at the new database.

**The switch (about 15–30 minutes of read-only time)**

5. **Freeze writes.** Set the repository variable `MAINTENANCE_READ_ONLY` to `true` and run the deploy
   (or on the server: set `Maintenance__ReadOnly="true"` in `.env`, then
   `docker compose -f docker-compose.prod.yml up -d --no-deps api`). Reading keeps working; every write
   gets "NoteFusion is moving to a new home for a few minutes…", and the apps keep everyone signed in.
6. Stop the background writers too, by making the database itself read-only:
   ```bash
   docker compose -f docker-compose.prod.yml exec db psql -U notefusion -d notefusion \
     -c "ALTER DATABASE notefusion SET default_transaction_read_only = on" \
     -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'notefusion' AND pid <> pg_backend_pid()"
   ```
7. **Final backup:**
   ```bash
   docker compose -f docker-compose.prod.yml exec db psql -U notefusion -d notefusion -c "SELECT pg_switch_wal()"
   docker compose -f docker-compose.prod.yml exec backup nf-backup-run dump
   docker compose -f docker-compose.prod.yml exec backup nf-backup-env restic snapshots --tag db --latest 1
   ```
   The dump log ends with `done: snapshot <id>, …, verified` (its status row cannot be written while the
   database is read-only; that is expected). Note the snapshot id.
8. **Restore at the new home** with that exact snapshot:
   `restore.sh --snapshot <id> --target-url <new database>` — it must end with
   *"OK: the restored database matches the manifest row for row"*. Then run `drill-checks.sql` against it.
   (The read-only setting from step 6 belongs to the old database and does not travel with the dump.)
9. **Photos**, only if they move: `rclone sync` the old bucket to the new one (or `restore-files.sh
   --avatars-to`), set `R2__*` (or the S3 equivalents) to the new bucket, and rewrite the links (E).
10. **Start the new stack** with the same secrets and `Maintenance__ReadOnly` unset. Check the console's
    System Health, sign in, open a sheet, run a transcription.
11. **Move the address:** point the DNS records at the new server. Payment webhooks follow the domain;
    a payment that arrived during the freeze was refused with 503 and the provider retries it (the
    reconciliation sweep catches any it does not).
12. **Leave the old server read-only** for a few days (never unfreeze it: two writable copies would
    split), then shut it down. Its backups stay in the bucket for their retention period.
13. **Backups at the new home:** run the backup service there with the same `BACKUP_*` settings — the
    restic repository simply continues — and a new `BACKUP_WALG_PREFIX` (a restored database is a new
    cluster). Run the restore drill once.

**Calling the move off** (anything before step 11 went wrong): the old server is untouched, so undo the
freeze and carry on there. The session has to be made writable before the setting can be removed:

```bash
docker compose -f docker-compose.prod.yml exec db psql -U notefusion -d notefusion \
  -c "SET default_transaction_read_only = off" -c "ALTER DATABASE notefusion RESET default_transaction_read_only"
```

then set `MAINTENANCE_READ_ONLY` back to `false` (or delete it) and deploy, and restart the API so its
connections pick up the change: `docker compose -f docker-compose.prod.yml restart api`.

---

## Settings to carry to a new provider

Secrets and variables are in GitHub (Settings → Secrets and variables → Actions); the deploy writes
them to the server. `env-names.txt` in every files backup lists what the server had set.

**Must carry over (the app breaks or users are affected without them)**

- `POSTGRES_PASSWORD` (or the new database's `Database__*` values), `TRANSCRIPTION_API_KEY`
- `JWT_PRIVATE_KEY_PEM`, `JWT_ISSUER`, `JWT_AUDIENCE` — the same key keeps everyone signed in and push working
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `DOMAIN_NAME`
- Email: `RESEND_API_KEY` (or `RESEND__APIKEY`), `RESEND__FROM`, `EMAIL__FROMADDRESS`, `EMAIL__ASSETBASEURL`, `EMAIL__USERESEND`
- `GOOGLE__CLIENTID`
- Billing: `BILLING__DEFAULTPROVIDER`, `BILLING__CHECKOUTCALLBACKURL`, `BACHS__BASEURL`, `BACHS__SECRETKEY`,
  `BACHS__WEBHOOKSECRET`, `BACHS__SUPPORTEDCURRENCIES`, `BACHS__PRODUCTMAP__*`, `PAYSTACK__SECRETKEY`,
  `PAYSTACK__BASEURL`, `PAYSTACK__SUPPORTEDCURRENCIES`, `PAYSTACK__WEBHOOKSECRET`, `FLUTTERWAVE__BASEURL`, `SQUAD__BASEURL`
- Photos: `R2__ACCOUNTID`, `R2__ACCESSKEYID`, `R2__SECRETACCESSKEY`, `R2__BUCKETNAME`, `R2__PUBLICBASEURL`, `R2__USER2`
- Backups: `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`,
  `BACKUP_ENCRYPTION_PASSWORD`, and `BACKUP_MIRROR` / `BACKUP_S3_REGION` / `BACKUP_WALG_PREFIX` if set
- The server's address: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` (new values for the new machine)

**Optional (features that switch off cleanly without them)**

`PUSH__USEEXPO`, `WEBPUSH_ENABLED`, `WEBPUSH_PUBLIC_KEY`, `WEBPUSH_PRIVATE_KEY`, `WEBPUSH_SUBJECT`,
`AUTH__RESETPASSWORDURL`, `PASSKEYS_RP_ID`, `PASSKEYS_ORIGINS`, `OUTREACH_*`, `GEMINI_API_KEY`,
`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GH_DEPLOY_TOKEN`, `BLOG_AUTODRAFT_*`, `BLOG_AUTOPUBLISH_DRAFTS`,
`YTDLP_COOKIES`, `YTDLP_PROXY`, `DOZZLE_USER`, `DOZZLE_PASSWORD_HASH`, `MAINTENANCE_READ_ONLY`.

Outside GitHub: the Caddyfile (in the files backup), the DNS records, the payment providers' webhook
URLs (domain-based, so unchanged if the domain is), and the photo bucket's custom domain.

---

## Day to day

```bash
cd /opt/notefusion
docker compose -f docker-compose.prod.yml logs --tail 50 backup                    # what it did
docker compose -f docker-compose.prod.yml exec backup nf-backup-env restic snapshots
docker compose -f docker-compose.prod.yml exec backup nf-backup-env wal-g backup-list
docker compose -f docker-compose.prod.yml exec backup nf-backup-run dump           # a backup now
```

The **Check EC2 Status** workflow prints the latest run of each kind and the archiver's counters.

**If the console says…**

- *"No verified database backup for …"* — read `logs backup`. Common causes: the bucket key was revoked
  or expired (make a new one, update the secrets, redeploy); the disk is full (the dump needs about as
  much free space as the database's size: `df -h /`).
- *"WAL archiving is behind or interrupted"* — the bucket was unreachable for a while or the spool filled;
  it catches up by itself. "dropped" means point-in-time recovery has a gap until the next base backup
  (run `nf-backup-run base` to close it now).
- *"WAL archiving has not reported…"* — the backup container is not running:
  `docker compose -f docker-compose.prod.yml up -d backup`.
- *"The last restore drill FAILED"* — open the run in GitHub (linked from the card); the failing step
  says what did not match. Treat it as urgent: it means a restore would not work.

**Changing the encryption password:** restic can add a new password to the repository
(`nf-backup-env restic key add`, then `restic key remove <old id>`); WAL-G's key is derived from the
password, so after changing it point `BACKUP_WALG_PREFIX` at a fresh prefix and run a base backup. Keep
the old password until the old WAL-G backups have aged out (8 days).

**Costs (R2, standard class):** about $0.015 per GB-month stored and no charge for downloads. Four
dumps a day deduplicate to little more than one; WAL compresses well. For today's database expect cents
a month; at 10 GB of dumps and WAL, well under a dollar.
