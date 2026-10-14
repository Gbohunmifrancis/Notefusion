"""Vocal isolation for full songs: MDX-Net (the UVR "Voc_FT" model) on onnxruntime.

A song is not a hum.  Drums, bass and chords make the mixture polyphonic, and no
monophonic pitch tracker can follow a voice through that.  So a linked song is first
split into vocals and the rest, and only the vocals go to the melody engine.

Why this model and runtime
──────────────────────────
MDX-Net is the family of spectrogram-masking networks behind Ultimate Vocal Remover.
``UVR-MDX-NET-Voc_FT`` is its vocal model, published as a 67 MB ONNX file under the MIT
licence, and it runs on the ``onnxruntime`` this image already carries for Basic Pitch.
That is the whole reason it was chosen over Demucs: comparable quality on a lead vocal,
no torch, and a hundred megabytes rather than two gigabytes added to the image.

How it is driven
────────────────
The network maps a chunk of the mixture's STFT to the same-shaped STFT of the vocals.
Layout (B, 4, F, T): channels are left-real, left-imaginary, right-real, right-imaginary;
F is the lowest ``DIM_F`` bins of an ``N_FFT``-point transform; T is ``DIM_T`` frames at
``HOP``.  A chunk is therefore ``HOP * (DIM_T - 1)`` samples of 44.1 kHz stereo.  Longer
audio is processed in overlapping chunks and cross-faded back together.

The model file is downloaded at image build time (see the Dockerfile) and found through
``NF_MDX_MODEL_PATH``.  Without it, ``available()`` is False and the caller transcribes
the mixture as-is rather than failing the job.

Where it runs
─────────────
One forward pass of this network needs about 1.6 GB of resident memory (batch one, arena
off; the input is fixed at 4 x 3072 x 256, so nothing shrinks it), and once it has run the
process keeps about 320 MB of that for good — onnxruntime's buffers and glibc's heap do
not go back to the kernel (``malloc_trim`` recovers 80 MB of it).  On the production box
that dead weight is what pushed every later stage, and the API beside it, into swap.  So
``separate_file`` runs the model in a child process (``python -m app.pipeline.separate``)
and relays its progress; when the child exits the memory is the kernel's again and the
worker is back to its hundred megabytes.  ``NF_SEPARATE_IN_PROCESS=1`` restores the old
in-process run; ``NF_SEPARATE_TIMEOUT`` (seconds) bounds a child that never finishes.
"""

import errno
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44_100
N_FFT = 7680
HOP = 1024
DIM_F = 3072
DIM_T = 256
CHUNK = HOP * (DIM_T - 1)  # 261 120 samples, 5.92 s
OVERLAP = 0.25  # fraction of a chunk shared with its neighbour
# Chunks per onnxruntime call. The model is batch-first, and a batch of four was the obvious
# throughput choice — until it was measured: on a 30 s clip it peaks at 10 GB of resident
# memory, against 1.4 GB for a batch of one with the arena off (below). The production
# box is a small EC2 instance, and that peak is what took the whole API down for seven
# seconds and lost every in-flight job when the kernel killed the worker. One chunk at a
# time is a third slower and a seventh of the memory; the memory is the constraint.
BATCH = max(1, int(os.getenv("NF_MDX_BATCH", "1")))
# onnxruntime's CPU memory arena and memory-pattern planning keep every activation buffer
# the session has ever needed. For this network that doubles the peak (2.8 GB against
# 1.4 GB at batch one) for a quarter less time. Off by default; NF_MDX_MEM_ARENA=1 buys
# the speed back on a machine with the memory to spare.
MEM_ARENA = os.getenv("NF_MDX_MEM_ARENA", "0").strip().lower() in ("1", "true", "yes")
# UVR applies this gain to the model's vocal estimate (``compensate`` in its model data).
COMPENSATION = 1.021

DEFAULT_MODEL_PATH = "/app/models/UVR-MDX-NET-Voc_FT.onnx"
# The model runs in a child process unless told otherwise (see "Where it runs" above).
IN_PROCESS = os.getenv("NF_SEPARATE_IN_PROCESS", "0").strip().lower() in ("1", "true", "yes")
# A child that is still running after this long is killed and the mixture transcribed instead.
# Six minutes of song take a minute or two on a box that is not swapping; twenty minutes is
# the ceiling, not a target, and it is inside the API's own thirty-minute give-up — a child
# holds _RUN_LOCK and the queue's one general worker for as long as it runs.
SEPARATE_TIMEOUT = float(os.getenv("NF_SEPARATE_TIMEOUT", "1200"))


class SeparationFailed(RuntimeError):
    """The vocal separation did not produce a stem; the caller transcribes the mixture."""

_SESSION = None
_SESSION_LOCK = threading.Lock()
# One separation at a time, whatever the queue's concurrency: two of these side by side is
# twice the peak memory, and the peak is the number that decides whether the box survives.
_RUN_LOCK = threading.Lock()


def model_path() -> Path:
    return Path(os.getenv("NF_MDX_MODEL_PATH", DEFAULT_MODEL_PATH))


def available() -> bool:
    return model_path().is_file()


def _session():
    global _SESSION
    with _SESSION_LOCK:
        if _SESSION is None:
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = max(1, int(os.getenv("NF_MDX_THREADS", "0")) or (os.cpu_count() or 1))
            options.enable_cpu_mem_arena = MEM_ARENA
            options.enable_mem_pattern = MEM_ARENA
            _SESSION = ort.InferenceSession(
                str(model_path()), sess_options=options, providers=["CPUExecutionProvider"]
            )
        return _SESSION


# ── STFT in the model's layout ────────────────────────────────────────────────


def _window() -> np.ndarray:
    # Periodic Hann, as torch.hann_window(periodic=True) which the model was trained with.
    n = np.arange(N_FFT)
    return (0.5 - 0.5 * np.cos(2.0 * np.pi * n / N_FFT)).astype(np.float32)


def _stft(x: np.ndarray) -> np.ndarray:
    """(2, CHUNK) stereo samples -> (4, DIM_F, DIM_T) real/imag spectrogram."""
    window = _window()
    pad = N_FFT // 2
    out = np.empty((4, DIM_F, DIM_T), dtype=np.float32)
    for ch in range(2):
        padded = np.pad(x[ch], (pad, pad), mode="reflect")
        frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP][:DIM_T]
        spec = np.fft.rfft(frames * window, axis=1)[:, :DIM_F].T  # (DIM_F, DIM_T)
        out[2 * ch] = spec.real
        out[2 * ch + 1] = spec.imag
    return out


def _istft(spec: np.ndarray) -> np.ndarray:
    """(4, DIM_F, DIM_T) -> (2, CHUNK) samples, inverting ``_stft`` exactly."""
    window = _window()
    n_bins = N_FFT // 2 + 1
    pad = N_FFT // 2
    length = CHUNK + 2 * pad
    out = np.zeros((2, CHUNK), dtype=np.float32)
    norm = np.zeros(length, dtype=np.float32)
    for t in range(DIM_T):
        norm[t * HOP : t * HOP + N_FFT] += window * window
    norm = np.where(norm > 1e-8, norm, 1.0)
    for ch in range(2):
        full = np.zeros((n_bins, DIM_T), dtype=np.complex64)
        full[:DIM_F] = spec[2 * ch] + 1j * spec[2 * ch + 1]
        frames = np.fft.irfft(full.T, n=N_FFT, axis=1) * window  # (DIM_T, N_FFT)
        y = np.zeros(length, dtype=np.float32)
        for t in range(DIM_T):
            y[t * HOP : t * HOP + N_FFT] += frames[t]
        out[ch] = (y / norm)[pad : pad + CHUNK]
    return out


# ── Separation ────────────────────────────────────────────────────────────────


def _crossfade(n: int) -> np.ndarray:
    """A raised-cosine fade spanning the overlap, applied to both ends of each chunk."""
    fade = int(CHUNK * OVERLAP)
    w = np.ones(n, dtype=np.float32)
    ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(fade) / fade)
    w[:fade] = ramp
    w[-fade:] = np.minimum(w[-fade:], ramp[::-1])
    return w


def separate_vocals(mix: np.ndarray, sr: int = SAMPLE_RATE, progress=lambda f: None) -> np.ndarray:
    """Vocals estimate for ``mix`` — (2, N) or (N,) float audio at 44.1 kHz — same shape.

    The whole signal is processed in chunks of ``CHUNK`` samples with ``OVERLAP``
    overlap, each chunk's estimate faded at both ends and overlap-added, so chunk
    boundaries do not click or drop energy.
    """
    if sr != SAMPLE_RATE:
        raise ValueError(f"separate_vocals expects {SAMPLE_RATE} Hz audio, got {sr}")
    with _RUN_LOCK:
        return _separate_locked(mix, progress)


def _separate_locked(mix: np.ndarray, progress) -> np.ndarray:
    mono = mix.ndim == 1
    x = np.stack([mix, mix]) if mono else np.asarray(mix, dtype=np.float32)
    n = x.shape[1]
    step = int(CHUNK * (1.0 - OVERLAP))
    # Pad so every sample is covered by a full chunk on both sides.
    front = int(CHUNK * OVERLAP)
    total = front + n + CHUNK
    padded = np.zeros((2, total), dtype=np.float32)
    padded[:, front : front + n] = x

    out = np.zeros_like(padded)
    weight = np.zeros(total, dtype=np.float32)
    fade = _crossfade(CHUNK)
    session = _session()
    starts = list(range(0, total - CHUNK + 1, step))
    name = session.get_inputs()[0].name
    for b in range(0, len(starts), BATCH):
        batch = starts[b : b + BATCH]
        specs = np.stack([_stft(padded[:, s : s + CHUNK]) for s in batch])  # (B, 4, F, T)
        est = session.run(None, {name: specs})[0]
        for s, spec in zip(batch, est):
            vocals = _istft(spec) * COMPENSATION
            out[:, s : s + CHUNK] += vocals * fade
            weight[s : s + CHUNK] += fade
        progress(min(1.0, (b + len(batch)) / len(starts)))
    weight = np.where(weight > 1e-6, weight, 1.0)
    out /= weight
    result = out[:, front : front + n]
    return result.mean(axis=0) if mono else result


def separate_file(wav_path: Path, out_path: Path, progress=lambda f: None,
                  backing_path: Path | None = None) -> Path:
    """Read a WAV, write its vocals estimate at 22 050 Hz mono — what the melody engine wants.

    With ``backing_path`` the instrumental — the mix minus that vocal estimate, which is
    what the model's residual is — is written there too, at the same rate and mono, for
    the "play it over the song" rehearsal mode. One pass of the model serves both.

    Runs in a child process by default (see the module notes); raises ``SeparationFailed``
    when the child could not deliver and ``MemoryError`` when the kernel killed it.
    """
    if IN_PROCESS:
        return _separate_here(wav_path, out_path, progress, backing_path)
    with _RUN_LOCK:
        return _separate_in_child(wav_path, out_path, progress, backing_path)


def _child_command(wav_path: Path, out_path: Path, backing_path: Path | None) -> list[str]:
    cmd = [sys.executable, "-u", "-m", "app.pipeline.separate", str(wav_path), str(out_path)]
    if backing_path is not None:
        cmd += ["--backing", str(backing_path)]
    return cmd


def _separate_in_child(wav_path: Path, out_path: Path, progress, backing_path: Path | None) -> Path:
    """Run ``_separate_here`` in a fresh interpreter and relay its ``progress <fraction>`` lines."""
    root = Path(__file__).resolve().parents[2]  # the directory that holds the ``app`` package
    timed_out = threading.Event()
    # stderr goes to a file, not a pipe: the parent reads stdout a line at a time, and a child
    # that filled a stderr pipe (a long traceback, a chatty library) would block on it while the
    # parent waited for the next progress line — a deadlock held until the timeout.
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as err_file:
        try:
            proc = subprocess.Popen(_child_command(wav_path, out_path, backing_path), cwd=str(root),
                                    stdout=subprocess.PIPE, stderr=err_file, text=True)
        except OSError as ex:
            # A box too deep in swap to fork is the very state this child exists for; the queue
            # treats either of these as "transcribe the mixture", only the log line differs.
            if ex.errno in (errno.ENOMEM, errno.EAGAIN):
                raise MemoryError(f"could not start the separation: {ex.strerror}") from ex
            raise SeparationFailed(f"could not start the separation: {ex.strerror or ex}") from ex

        def kill():
            timed_out.set()
            proc.kill()

        timer = threading.Timer(SEPARATE_TIMEOUT, kill)
        timer.start()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                if line.startswith("progress "):
                    try:
                        progress(min(1.0, max(0.0, float(line.split()[1]))))
                    except (ValueError, IndexError):
                        pass
            proc.wait()
        finally:
            timer.cancel()
            if proc.poll() is None:  # the relay raised: the child does not go on alone
                proc.kill()
                proc.wait()
            proc.stdout.close()
        err_file.seek(0)
        err = err_file.read()
    if timed_out.is_set():
        raise SeparationFailed(f"vocal separation gave up after {SEPARATE_TIMEOUT:.0f}s")
    if proc.returncode != 0:
        tail = " | ".join(l.strip() for l in err.strip().splitlines()[-3:]) or "no output"
        # -9 is the kernel's OOM killer (our own kill is handled above).
        if proc.returncode == -9 or "MemoryError" in err:
            raise MemoryError(f"vocal separation ran out of memory: {tail}")
        raise SeparationFailed(f"vocal separation failed (exit {proc.returncode}): {tail}")
    if not Path(out_path).is_file():
        raise SeparationFailed("vocal separation ended without writing the stem")
    return Path(out_path)


def _separate_here(wav_path: Path, out_path: Path, progress=lambda f: None,
                   backing_path: Path | None = None) -> Path:
    """The separation itself, in this process."""
    import librosa
    import soundfile as sf

    from app.config import settings

    y, sr = librosa.load(str(wav_path), sr=SAMPLE_RATE, mono=False, duration=settings.audio_limit_seconds)
    if y.ndim == 1:
        y = np.stack([y, y])
    vocals = separate_vocals(y, SAMPLE_RATE, progress=progress)
    mono = librosa.resample(vocals.mean(axis=0), orig_sr=SAMPLE_RATE, target_sr=22_050)
    sf.write(str(out_path), mono.astype(np.float32), 22_050, format="WAV", subtype="PCM_16")
    if backing_path is not None:
        n = min(y.shape[1], vocals.shape[1])
        residual = (y[:, :n] - vocals[:, :n]).mean(axis=0)
        backing = librosa.resample(residual, orig_sr=SAMPLE_RATE, target_sr=22_050)
        peak = float(np.max(np.abs(backing))) if backing.size else 0.0
        if peak > 1.0:
            backing = backing / peak
        sf.write(str(backing_path), backing.astype(np.float32), 22_050, format="WAV", subtype="PCM_16")
    return out_path


# ── Is there a band behind the voice? ─────────────────────────────────────────
# A song uploaded as "a tune I hummed" (``separate=false``) used to be transcribed as the
# mixture, which on the real songs in ``tests.accuracy.songs`` is 2.5x the note errors of
# the isolated vocal.  So the queue asks this first, on the first minute of the upload.
#
# The cue is polyphony, read cheaply: on a constant-Q spectrum smoothed over five frames
# (so a tonal partial survives and noise does not), count the spectral peaks standing
# 8 dB over their surroundings that are NOT harmonics of the frame's strongest pitch.  A
# voice alone, however noisy the room, is one harmonic series and leaves few; a band
# leaves the bass, the chord tones and the backing voices.  Mean per frame:
#   band songs       synthetic 6.3-8.6 (36 songs); ADC2004 + MIREX05 2.9-10.9, median 8.6 (33)
#   solo voices      sung corpus 0.3-4.2 (61 clips); Vocadito's 40 real singers 1.3-4.7
#   one instrument   instrument corpus 1.2-6.3 (40 clips), one over 5: a heavy-vibrato tone
# ACCOMPANIMENT_MIN_PEAKS = 5 isolates 68 of the 69 songs and none of the 101 solo voices.
# Two cheaper cues were tried first and do not separate them: the percussive (HPSS)
# energy share and the energy left after removing the main harmonic series are both as
# high on Vocadito's phone-and-room noise as on a band.
ACCOMPANIMENT_SECONDS = 60.0
ACCOMPANIMENT_MIN_PEAKS = 5.0
_CQT_BINS_PER_OCTAVE = 36
# A vocal stem this far under the mix holds no voice: the upload was instruments only (an
# instrumental lead measured -36 to -60 dB, a sung song -0.3 to -12 dB), and the melody is
# then in the mixture, not in an empty stem.
VOICE_MIN_SHARE_DB = -25.0


def accompaniment(path: Path) -> float:
    """Mean count per frame of tonal peaks off the strongest pitch's harmonics (see above)."""
    import librosa
    from scipy import ndimage

    y, sr = librosa.load(str(path), sr=22_050, mono=True, duration=ACCOMPANIMENT_SECONDS)
    if y.size < sr:
        return 0.0
    bpo = _CQT_BINS_PER_OCTAVE
    c = np.abs(librosa.cqt(y, sr=sr, hop_length=512, fmin=librosa.note_to_hz("A1"),
                           n_bins=bpo * 6, bins_per_octave=bpo))
    level = np.sqrt(np.mean(c ** 2, axis=0))
    active = level > np.percentile(level, 95) * 10.0 ** (-25.0 / 20.0)
    db = ndimage.median_filter(20.0 * np.log10(np.maximum(c, 1e-9)), size=(1, 5))
    floor = ndimage.median_filter(db, size=(bpo // 2 + 1, 1))
    peaks = ((db - floor > 8.0) & (db == ndimage.maximum_filter(db, size=(3, 1))))[:, active]
    if peaks.shape[1] == 0:
        return 0.0
    power = np.where(peaks, 10.0 ** (db[:, active] / 10.0), 0.0)
    bins = power.shape[0]
    harmonics = [int(round(bpo * np.log2(h))) for h in range(1, 11)]
    salience = np.zeros_like(power)
    for offset in harmonics:
        salience[: bins - offset] += power[offset:]
    f0 = np.argmax(salience[: bins - bpo], axis=0)
    frames = np.arange(power.shape[1])
    series = np.zeros_like(peaks)
    for offset in harmonics:
        for wobble in range(-2, 3):  # +-2 bins (67 cents): a vibrato'd harmonic is still one
            series[np.clip(f0 + offset + wobble, 0, bins - 1), frames] = True
    return float(np.mean(np.sum(peaks & ~series, axis=0)))


def has_accompaniment(path: Path) -> bool:
    return accompaniment(path) >= ACCOMPANIMENT_MIN_PEAKS


def voice_share_db(vocals_path: Path, backing_path: Path) -> float:
    """The vocal stem's share of the mix's energy in dB (0 is all voice)."""
    import soundfile as sf

    vocals, _ = sf.read(str(vocals_path), dtype="float32")
    backing, _ = sf.read(str(backing_path), dtype="float32")
    n = min(len(vocals), len(backing))
    voice = float(np.mean(vocals[:n] ** 2)) if n else 0.0
    rest = float(np.mean(backing[:n] ** 2)) if n else 0.0
    return float(10.0 * np.log10(max(voice, 1e-12) / max(voice + rest, 1e-12)))


if __name__ == "__main__":  # pragma: no cover - exercised through _separate_in_child
    import argparse

    parser = argparse.ArgumentParser(description="Separate a WAV's vocals; progress is printed as 'progress <fraction>'.")
    parser.add_argument("wav")
    parser.add_argument("out")
    parser.add_argument("--backing", default=None)
    args = parser.parse_args()
    _separate_here(Path(args.wav), Path(args.out),
                   progress=lambda f: print(f"progress {f:.4f}", flush=True),
                   backing_path=Path(args.backing) if args.backing else None)
    print("done", flush=True)
