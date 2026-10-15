#!/bin/sh
# Runs as root only long enough to hand the worker what it needs, then drops to the
# unprivileged `nf` user and execs the command (uvicorn), so signals reach it directly.
#
#  - NF_JOB_DIR: the prod job-data volume predates this user and is owned by root, so it
#    is created if missing and chowned to nf on every start (it holds a few journal files).
#  - NF_YTDLP_COOKIES_FILE: the deploy bind-mounts a root-owned 0600 cookies file that nf
#    cannot read, so a private 0600 copy owned by nf is made and the variable points at it.
#    A missing or empty source (the /dev/null mount when no cookies are set) is left alone.
#
# Started as any user other than root (docker run --user ...), it runs the command as is.
set -eu

RUN_USER=nf

if [ "$(id -u)" != "0" ]; then
    exec "$@"
fi

if [ -n "${NF_JOB_DIR:-}" ]; then
    mkdir -p "$NF_JOB_DIR"
    chown -R "$RUN_USER:$RUN_USER" "$NF_JOB_DIR"
fi

if [ -n "${NF_YTDLP_COOKIES_FILE:-}" ] && [ -f "$NF_YTDLP_COOKIES_FILE" ] && [ -s "$NF_YTDLP_COOKIES_FILE" ]; then
    private_dir=/run/nf
    mkdir -p "$private_dir"
    chown "$RUN_USER:$RUN_USER" "$private_dir"
    chmod 0700 "$private_dir"
    install -o "$RUN_USER" -g "$RUN_USER" -m 0600 "$NF_YTDLP_COOKIES_FILE" "$private_dir/ytdlp-cookies.txt"
    export NF_YTDLP_COOKIES_FILE="$private_dir/ytdlp-cookies.txt"
fi

# setpriv keeps the environment, so HOME (and the caches under it: yt-dlp, Deno, numba)
# would still point at /root.
export HOME="/home/$RUN_USER"

exec setpriv --reuid="$RUN_USER" --regid="$RUN_USER" --init-groups --no-new-privs "$@"
