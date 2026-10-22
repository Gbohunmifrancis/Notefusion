"""A song's bar lines from its band (``app.pipeline.downbeats``), and the band's bleed gated out of
its vocal stem (``transcriber._gate_bleed``), on bands built here: kick and bass on the downbeat
(and on beat three of four), the chord changing every bar, hi-hats on the quavers."""

import numpy as np
import pytest

from app.pipeline import downbeats
from app.pipeline.transcriber import _gate_bleed, _meter_and_pickup

SR = 22_050
BPM = 100.0
SPB = 60.0 / BPM
LEAD = 0.4  # silence before the band starts, seconds
ROOTS = (48, 53, 55, 48, 45, 50, 55, 48)  # C F G C A D G C, one a bar


def _hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def _add(buf: np.ndarray, x: np.ndarray, at: float) -> None:
    i = int(at * SR)
    if i < buf.size:
        buf[i:i + x.size] += x[: buf.size - i]


def _band(beats_per_bar: int, bars: int) -> np.ndarray:
    rng = np.random.default_rng(7)
    out = np.zeros(int((LEAD + (bars * beats_per_bar + 2) * SPB) * SR))
    t = np.arange(int(0.25 * SR)) / SR
    kick = np.sin(2 * np.pi * 55.0 * t) * np.exp(-t / 0.06)
    hat = rng.normal(0.0, 1.0, int(0.03 * SR)) * np.exp(-np.arange(int(0.03 * SR)) / (0.008 * SR))
    hat = np.diff(hat, prepend=0.0)
    for bar in range(bars):
        root = ROOTS[bar % len(ROOTS)]
        start = LEAD + bar * beats_per_bar * SPB
        span = np.arange(int(beats_per_bar * SPB * SR)) / SR
        env = np.minimum(1.0, span / 0.02) * np.exp(-span / 3.0)
        for m in (root + 12, root + 16, root + 19):  # the chord, a bar long
            _add(out, 0.12 * np.sin(2 * np.pi * _hz(m) * span) * env, start)
        downs = (0, 2) if beats_per_bar == 4 else (0,)
        for b in downs:
            _add(out, 0.6 * kick, start + b * SPB)
            bass = np.arange(int(1.8 * SPB * SR)) / SR
            _add(out, 0.25 * np.sin(2 * np.pi * _hz(root - 12) * bass) * np.exp(-bass / 0.8), start + b * SPB)
        for h in range(2 * beats_per_bar):
            _add(out, 0.05 * hat, start + h * SPB / 2.0)
    return out.astype(np.float32)


def _even_line(n: int) -> tuple[list[float], list[float]]:
    """A tune of even crotchets: no held note says where the bar is."""
    return [float(i) for i in range(n)], [1.0] * n


@pytest.mark.parametrize("beats,first_beat_in_bar", [(4, 3), (4, 0), (3, 2)])
def test_the_band_writes_the_meter_and_the_pickup_an_even_tune_cannot(beats, first_beat_in_bar):
    band = _band(beats, 14)
    # The tune starts on beat ``first_beat_in_bar`` (from 0) of the band's third bar.
    origin = LEAD + (2 * beats + first_beat_in_bar) * SPB
    starts, durs = _even_line(30)
    accents = downbeats.read(band, SR, origin, BPM, 0.0, 30.0)
    assert accents is not None and accents.clear()
    meter, pickup = _meter_and_pickup(starts, durs, None, band=accents)
    assert meter == f"{beats}/4"
    assert pickup == first_beat_in_bar  # where the first note sits in its bar


def test_a_meter_given_is_kept_and_the_band_only_places_its_bars():
    band = _band(4, 14)
    starts, durs = _even_line(30)
    accents = downbeats.read(band, SR, LEAD + 9 * SPB, BPM, 0.0, 30.0)  # the second beat of the third bar
    assert _meter_and_pickup(starts, durs, "4/4", band=accents) == ("4/4", 1.0)


def test_half_a_bar_in_doubt_is_settled_where_the_music_starts():
    # Kick and bass on one and three, a pad that never changes chord: only the start tells one
    # from three.  Without the song's start (a section cut from inside it) the tie stays a tie.
    band = _band(4, 14)
    accents = downbeats.read(band, SR, LEAD + 8 * SPB, BPM, 0.0, 30.0)
    assert accents.start == pytest.approx(-8.0, abs=0.25)
    assert accents.starts_bar(4, 0.0) and not accents.starts_bar(4, 2.0)
    inside = downbeats.read(band, SR, LEAD + 8 * SPB, BPM, 0.0, 30.0, song_start=False)
    assert inside.start is None and not inside.starts_bar(4, 0.0)


def test_a_band_with_no_beat_leaves_the_bars_to_the_singer():
    rng = np.random.default_rng(3)
    hiss = (0.05 * rng.normal(0.0, 1.0, int(30 * SR))).astype(np.float32)
    accents = downbeats.read(hiss, SR, 1.0, BPM, 0.0, 30.0)
    assert accents is not None and not accents.clear()
    # A tune whose long notes fall every third beat from its second note: the singer's own rule.
    starts = [0.0] + [1.0 + 3 * k + j for k in range(8) for j in (0.0, 2.0)]
    durs = [1.0] + [2.0, 1.0] * 8
    assert _meter_and_pickup(starts, durs, None, band=accents) == _meter_and_pickup(starts, durs, None)


def test_the_band_leaking_into_the_vocal_stem_is_gated_and_the_singer_is_not():
    band = _band(4, 10)
    n = band.size
    t = np.arange(n) / SR
    singer = np.where(t >= 6.0, 0.3 * np.sin(2 * np.pi * 330.0 * t), 0.0).astype(np.float32)
    stem = singer + 10.0 ** (-22.0 / 20.0) * band  # the bleed, under everything
    gated = _gate_bleed(stem, band, SR)
    intro, sung = slice(int(1.0 * SR), int(5.5 * SR)), slice(int(6.5 * SR), n)
    assert np.sqrt(np.mean(gated[intro] ** 2)) < 0.05 * np.sqrt(np.mean(stem[intro] ** 2))
    np.testing.assert_allclose(gated[sung], stem[sung], atol=1e-6)


def test_an_a_cappella_stem_is_never_gated():
    t = np.arange(int(8 * SR)) / SR
    stem = np.where(t >= 2.0, 0.3 * np.sin(2 * np.pi * 330.0 * t), 1e-4 * np.sin(2 * np.pi * 80.0 * t)).astype(np.float32)
    assert np.array_equal(_gate_bleed(stem, np.zeros_like(stem), SR), stem)
