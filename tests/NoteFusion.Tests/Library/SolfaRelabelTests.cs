using NoteFusion.Application.Library.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Library;

/// <summary>
/// The API's own re-label, which is the tier most exposed to the one way directional
/// chromatic spelling can go wrong. <see cref="SolfaMapper.AscendingFlags"/> is positional —
/// it takes a note's neighbours to be its neighbours in the list it was handed — and this is
/// the only caller that does not receive its notes in melodic order to begin with: the note
/// list is an EF owned collection, so its order is the database's.
/// </summary>
public class SolfaRelabelTests
{
    private static readonly MusicalKey CMajor = new(0, KeyMode.Major);

    /// <summary>E Eb D Db C — a chromatic descent, so both accidentals are flat-side.</summary>
    private static readonly int[] Descent = [64, 63, 62, 61, 60];

    private static Transcription Saved(IEnumerable<NoteEvent> notes) => new(
        Guid.NewGuid(),
        "descent",
        CMajor,
        96,
        "4/4",
        "<score/>",
        notes,
        0.9);

    private static NoteEvent Note(int pitch, double startBeat) =>
        new() { PitchMidi = pitch, StartBeat = startBeat, DurationBeats = 1.0, Confidence = 0.9 };

    private static List<string> SyllablesOf(Transcription t) =>
        [.. SavedTranscriptionMapper.ToDto(t, includeNotes: true).Notes!.Select(n => n.Solfa)];

    [Fact]
    public void A_falling_chromatic_is_relabelled_from_the_flat_side()
    {
        var t = Saved(Descent.Select((p, i) => Note(p, i)));

        Assert.Equal(["m", "ma", "r", "ra", "d"], SyllablesOf(t));
    }

    [Fact]
    public void A_rising_chromatic_is_relabelled_from_the_sharp_side()
    {
        var t = Saved(Descent.Reverse().Select((p, i) => Note(p, i)));

        Assert.Equal(["d", "de", "r", "re", "m"], SyllablesOf(t));
    }

    [Fact]
    public void Storage_order_does_not_change_a_single_syllable()
    {
        // The same music, handed over shuffled — which is what an owned collection loaded
        // without an ORDER BY can legitimately do. Direction is read from start beats, so
        // every note must come back spelled exactly as it is when the list is in order.
        var inOrder = Saved(Descent.Select((p, i) => Note(p, i)));
        var shuffled = Saved([Note(62, 2), Note(60, 4), Note(63, 1), Note(61, 3), Note(64, 0)]);

        var expectedByStartBeat = SyllablesOf(inOrder);
        var actual = SavedTranscriptionMapper.ToDto(shuffled, includeNotes: true).Notes!;

        foreach (var note in actual)
            Assert.Equal(expectedByStartBeat[(int)note.StartBeat], note.Solfa);
    }

    [Fact]
    public void The_dto_keeps_the_stored_order_rather_than_being_sorted()
    {
        // Sorting for the flags must not leak into the payload: the client indexes into this
        // list to edit a note, so reordering it would move which note an edit lands on.
        var shuffled = Saved([Note(62, 2), Note(60, 4), Note(63, 1), Note(61, 3), Note(64, 0)]);

        var notes = SavedTranscriptionMapper.ToDto(shuffled, includeNotes: true).Notes!;

        Assert.Equal([62, 60, 63, 61, 64], notes.Select(n => n.PitchMidi));
    }

    [Fact]
    public void A_diatonic_melody_is_untouched_by_direction()
    {
        // The two tables agree on all seven diatonic degrees, so a scale with no accidentals
        // reads identically up and down. This is what bounds the blast radius of the change.
        int[] scale = [60, 62, 64, 65, 67];
        var up = Saved(scale.Select((p, i) => Note(p, i)));
        var down = Saved(scale.Reverse().Select((p, i) => Note(p, i)));

        Assert.Equal(["d", "r", "m", "f", "s"], SyllablesOf(up));
        Assert.Equal(["s", "f", "m", "r", "d"], SyllablesOf(down));
    }
}
