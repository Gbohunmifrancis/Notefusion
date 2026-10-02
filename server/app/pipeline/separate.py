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
"""

import os
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
BATCH = 4  # chunks per onnxruntime call; the model is batch-first
# UVR applies this gain to the model's vocal estimate (``compensate`` in its model data).
COMPENSATION = 1.021

DEFAULT_MODEL_PATH = "/app/models/UVR-MDX-NET-Voc_FT.onnx"

_SESSION = None
_SESSION_LOCK = threading.Lock()


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


def separate_file(wav_path: Path, out_path: Path, progress=lambda f: None) -> Path:
    """Read a WAV, write its vocals estimate at 22 050 Hz mono — what the melody engine wants."""
    import librosa
    import soundfile as sf

    y, sr = librosa.load(str(wav_path), sr=SAMPLE_RATE, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    vocals = separate_vocals(y, SAMPLE_RATE, progress=progress)
    mono = librosa.resample(vocals.mean(axis=0), orig_sr=SAMPLE_RATE, target_sr=22_050)
    sf.write(str(out_path), mono.astype(np.float32), 22_050, format="WAV", subtype="PCM_16")
    return out_path
