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
    && rm -rf /var/lib/apt/lists/*

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

COPY app ./app

CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"
