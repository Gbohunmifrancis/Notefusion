"""The measurement harness's own definitions: the frozen Vocadito reference.

The benchmarks themselves are slow and run by hand (``tests.accuracy``); these check
that what they score against says what it claims to.
"""

import json

from tests.accuracy import vocadito


def _reference() -> dict:
    return json.loads(vocadito.REFERENCE_PATH.read_text())


def test_frozen_vocadito_reference_scores_the_clips_both_annotators_agree_on():
    reference = _reference()
    clips = {int(c): entry for c, entry in reference["clips"].items()}
    assert sorted(clips) == list(range(1, 41))
    for entry in clips.values():
        agree = bool(entry["A1"] and entry["A2"] and entry["A1"]["root"] == entry["A2"]["root"])
        assert entry["consensus"] == agree
    assert reference["scored_clips"] == [c for c in sorted(clips) if clips[c]["consensus"]]
    assert len(reference["scored_clips"]) == 34


def test_frozen_vocadito_reference_labels_the_accidental_columns_tunes():
    reference = _reference()
    scored = reference["scored_clips"]
    tune_class = {int(c): entry["tune_class"] for c, entry in reference["clips"].items()}
    assert [c for c in scored if tune_class[c] == "chromatic"] == [19, 39, 40]
    assert len([c for c in scored if tune_class[c] == "diatonic_high"]) == 14
