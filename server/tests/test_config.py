"""Tests for the env-driven accuracy flags.

Both flags are read per access rather than at import, because the accuracy harness
A/Bs them inside a single process.  These tests pin that behaviour along with the
parsing, since a flag that silently froze at its first value would make every
measured before/after comparison a lie.
"""

import pytest
from app.config import settings

# ── beat_align ────────────────────────────────────────────────────────────────


class TestBeatAlign:
    def test_defaults_on(self, monkeypatch):
        monkeypatch.delenv("NF_BEAT_ALIGN", raising=False)
        assert settings.beat_align is True

    @pytest.mark.parametrize("value", ["0", "false", "False", "NO", " no "])
    def test_disabled_by_falsey_values(self, monkeypatch, value):
        monkeypatch.setenv("NF_BEAT_ALIGN", value)
        assert settings.beat_align is False

    @pytest.mark.parametrize("value", ["1", "true", "yes", "on"])
    def test_anything_else_leaves_it_on(self, monkeypatch, value):
        monkeypatch.setenv("NF_BEAT_ALIGN", value)
        assert settings.beat_align is True

    def test_reads_the_environment_on_every_access(self, monkeypatch):
        monkeypatch.setenv("NF_BEAT_ALIGN", "1")
        assert settings.beat_align is True
        monkeypatch.setenv("NF_BEAT_ALIGN", "0")
        assert settings.beat_align is False


# ── quantize_divisors ─────────────────────────────────────────────────────────


class TestQuantizeDivisors:
    def test_defaults_to_eighths(self, monkeypatch):
        # Sixteenths were the default until the corpus showed they cost degree
        # accuracy; see the property docstring for the numbers.
        monkeypatch.delenv("NF_QUANTIZE_DIVISORS", raising=False)
        assert settings.quantize_divisors == (2,)

    def test_parses_a_comma_list(self, monkeypatch):
        monkeypatch.setenv("NF_QUANTIZE_DIVISORS", "4,3")
        assert settings.quantize_divisors == (4, 3)

    def test_tolerates_whitespace(self, monkeypatch):
        monkeypatch.setenv("NF_QUANTIZE_DIVISORS", " 4 , 3 ")
        assert settings.quantize_divisors == (4, 3)

    @pytest.mark.parametrize("value", ["", "eighth", "-2", "4.5", ","])
    def test_unparseable_values_fall_back_to_the_default(self, monkeypatch, value):
        # A typo in a deploy must not fail every transcription with a ValueError.
        monkeypatch.setenv("NF_QUANTIZE_DIVISORS", value)
        assert settings.quantize_divisors == (2,)

    def test_zero_is_dropped(self, monkeypatch):
        # music21 divides by the divisor; 0 would raise inside quantize().
        monkeypatch.setenv("NF_QUANTIZE_DIVISORS", "0,4")
        assert settings.quantize_divisors == (4,)


class TestChromaticSpelling:
    def test_defaults_to_direction(self, monkeypatch):
        monkeypatch.delenv("NF_CHROMATIC_SPELLING", raising=False)
        assert settings.chromatic_spelling == "direction"

    @pytest.mark.parametrize("value", ["direction", "ascending", "descending"])
    def test_accepts_supported_values(self, monkeypatch, value):
        monkeypatch.setenv("NF_CHROMATIC_SPELLING", value)
        assert settings.chromatic_spelling == value

    def test_invalid_values_fall_back_to_direction(self, monkeypatch):
        monkeypatch.setenv("NF_CHROMATIC_SPELLING", "flat-first")
        assert settings.chromatic_spelling == "direction"
