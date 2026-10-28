# NoteFusion transcription API — Dockerised FastAPI + Basic Pitch (ONNX).
# Build:  docker build -t notefusion-transcription-api .
# Run:    docker run -p 8000:8000 --rm notefusion-transcription-api

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libsndfile1 for soundfile/librosa audio I/O.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Deno, the JavaScript runtime yt-dlp uses for YouTube's player challenges (yt-dlp-ejs).
# Without one, YouTube extraction is deprecated and formats go missing.  (yt-dlp-ejs needs
# Deno 2.3 or later; yt-dlp's own `deno` extra asks for 2.6.6 or later.)
COPY --from=denoland/deno:bin-2.9.7 /deno /usr/local/bin/deno

WORKDIR /app

# Install dependencies first so layers cache when source changes.
COPY requirements.txt .
RUN pip install -r requirements.txt
# basic-pitch 0.4.0 pins tensorflow, which has no Python 3.12 Linux wheels;
# install without deps and provide the real ONNX/librosa runtime ourselves.
RUN pip install --no-deps basic-pitch==0.4.0

# Fetch the Basic Pitch model weights at build time so inference can start
# immediately in a cold container ( Basic Pitch downloads on first use otherwise ).
# Import first so a missing runtime dep fails the build loudly instead of at
# container start.
RUN python - <<'PY'
from basic_pitch.inference import Model
from basic_pitch import ICASSP_2022_MODEL_PATH
Model(ICASSP_2022_MODEL_PATH)
PY

# Vocal-isolation model for linked songs (MDX-Net, MIT licence, ~67 MB).  Fetched at
# build time like the Basic Pitch weights, so a cold container never downloads.
ENV NF_MDX_MODEL_PATH=/app/models/UVR-MDX-NET-Voc_FT.onnx
RUN mkdir -p /app/models && python - <<'PY'
import urllib.request
url = "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx"
urllib.request.urlretrieve(url, "/app/models/UVR-MDX-NET-Voc_FT.onnx")
PY
# A release asset can be replaced under the same URL; the build fails unless it is the file
# that was reviewed.  A deliberate model change updates this hash with it.
RUN echo "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111  /app/models/UVR-MDX-NET-Voc_FT.onnx" | sha256sum -c -

# The reader for photos and PDFs of printed music (homr, AGPL-3.0; THIRD_PARTY.md): installed unmodified in a
# virtual environment of its own and run as its own program by app/pipeline/sheet_reader.py, never imported.
# Its models (~180 MB) are fetched at build time, as the other models are; poppler-utils draws a PDF's pages.
ENV NF_OMR_BIN=/opt/homr/bin/homr
RUN python -m venv /opt/homr \
    && /opt/homr/bin/pip install homr==0.7.0 \
    && /opt/homr/bin/homr --init

# The newest yt-dlp on every build.  requirements.txt leaves it unpinned, but the layer that
# installs requirements.txt is cached until that file changes, so on its own a rebuild kept
# whatever yt-dlp the cache held.  The deploy passes a new YTDLP_REFRESH on every run (and a
# weekly scheduled run rebuilds just for this), which re-runs this one small layer; the model
# layers above stay cached.  At run time the worker also updates itself (below).
ARG YTDLP_REFRESH=manual
RUN echo "yt-dlp refresh ${YTDLP_REFRESH}" \
    && pip install --upgrade "yt-dlp[default]" \
    && yt-dlp --version

# The worker installs the newest nightly yt-dlp beside the image's at startup and once a day
# (app/ingest/ytdlp_update.py), into its own home: YouTube breaks older releases every few
# weeks, faster than images are rebuilt.  An empty NF_YTDLP_UPDATE_DIR turns that off.
ENV NF_YTDLP_UPDATE_DIR=/home/nf/.local/share/nf-ytdlp

# The worker runs as an unprivileged user.  The entrypoint starts as root only to make the
# job-data volume (root-owned on servers that predate this user) and the root-only cookies
# file usable by it, then drops to it with setpriv (util-linux, in the base image).
# /var/lib/notefusion is created here so a fresh named volume starts out owned by nf.
# The code and models stay root-owned and read-only to nf; it writes only to /tmp, the job
# directory and its home (yt-dlp, Deno and numba caches).
RUN groupadd --system --gid 10001 nf \
    && useradd --system --uid 10001 --gid nf --home-dir /home/nf --create-home --shell /usr/sbin/nologin nf \
    && mkdir -p /var/lib/notefusion/jobs \
    && chown -R nf:nf /var/lib/notefusion
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

COPY app ./app

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
# exec: uvicorn replaces the shell, so it is the process the stop signal reaches.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
