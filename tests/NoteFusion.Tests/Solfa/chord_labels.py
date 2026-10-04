"""Writes chord_labels.txt: every chord name the worker's ``chords.label`` gives, for the C#
ChordSpeller to be checked against (ChordSpellerTests.Every_chord_is_named_as_the_worker_names_it).

Run from server/ after a change to either side:
    PYTHONPATH=. python ../tests/NoteFusion.Tests/Solfa/chord_labels.py > ../tests/NoteFusion.Tests/Solfa/chord_labels.txt

One line per key, root and quality: tonic pitch class, mode, root, quality, the root's solfa, the
plain symbol, then the slash-chord symbol over each chord tone above the root, in the order
``chords.QUALITIES`` lists the tones.
"""

from app.pipeline import chords

for tonic in range(12):
    for mode in ("major", "minor"):
        name = chords.tonic_name(tonic, mode)
        for root in range(12):
            for quality, tones in chords.QUALITIES.items():
                spans = [chords.ChordSpan(0.0, 1.0, root, quality, None)]
                spans += [chords.ChordSpan(0.0, 1.0, root, quality, (root + iv) % 12) for iv in tones[1:]]
                labelled = chords.label(spans, name, mode)
                print(tonic, mode, root, quality, labelled[0].solfa, *(c.symbol for c in labelled))
