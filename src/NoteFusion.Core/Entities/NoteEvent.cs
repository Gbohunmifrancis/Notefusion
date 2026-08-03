namespace NoteFusion.Core.Entities;

/// <summary>
/// A single transcribed note as returned by the API and edited in the client.
/// Both notation views (staff and solfa) are derived from the note list, which is
/// why tap-to-edit updates both (TRD §6).
/// </summary>
public sealed record NoteEvent
{
    public required int PitchMidi { get; init; }

    /// <summary>Onset position in beats from the start of the clip (post-quantisation).</summary>
    public required double StartBeat { get; init; }

    public required double DurationBeats { get; init; }

    /// <summary>Model confidence 0–1; drives per-note confidence UI.</summary>
    public double Confidence { get; init; } = 1.0;
}
