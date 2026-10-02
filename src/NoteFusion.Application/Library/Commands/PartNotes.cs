using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Library.Commands;

/// <summary>Wire parts to stored parts: pitches and timing only, never the solfa the client sent.</summary>
internal static class PartNotes
{
    public static Dictionary<string, List<NoteEvent>>? FromDtos(IReadOnlyDictionary<string, PartDto>? parts)
    {
        if (parts is null || parts.Count == 0) return null;
        return parts
            .Where(kv => kv.Value?.Notes is { Count: > 0 })
            .ToDictionary(
                kv => kv.Key.Trim().ToLowerInvariant(),
                kv => kv.Value.Notes.Select(n => new NoteEvent
                {
                    PitchMidi = n.PitchMidi,
                    StartBeat = n.StartBeat,
                    DurationBeats = n.DurBeats,
                    Confidence = n.Conf
                }).ToList());
    }
}
