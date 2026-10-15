using System.Text;
using FluentValidation;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// The largest sheet the library takes. Every one of these is far above anything the worker writes (a
/// long song is a few hundred notes and a few hundred KB of MusicXML), so a real sheet never meets them;
/// they exist so one request cannot write megabytes of JSON into a row that every library read then loads.
/// </summary>
public static class SheetLimits
{
    public const int MaxMusicXmlBytes = 2 * 1024 * 1024;
    public const int MaxNotes = 5000;
    public const int MaxParts = 8;
    public const int MaxNotesPerPart = 5000;

    /// <summary>A score (melody or parts) of at most <see cref="MaxMusicXmlBytes"/> in UTF-8.</summary>
    public static IRuleBuilderOptions<T, string?> WithinScoreSize<T>(this IRuleBuilder<T, string?> rule)
        => rule
            .Must(xml => xml is null || Encoding.UTF8.GetByteCount(xml) <= MaxMusicXmlBytes)
            .WithMessage("This score is too large to save. Try a shorter section.");

    /// <summary>At most <see cref="MaxNotes"/> notes.</summary>
    public static IRuleBuilderOptions<T, IReadOnlyList<NoteEventDto>?> WithinNoteCount<T>(
        this IRuleBuilder<T, IReadOnlyList<NoteEventDto>?> rule)
        => rule
            .Must(notes => notes is null || notes.Count <= MaxNotes)
            .WithMessage($"A sheet can hold up to {MaxNotes:N0} notes. Try a shorter section.");

    /// <summary>At most <see cref="MaxParts"/> voices of at most <see cref="MaxNotesPerPart"/> notes each.</summary>
    public static IRuleBuilderOptions<T, IReadOnlyDictionary<string, PartDto>?> WithinPartsSize<T>(
        this IRuleBuilder<T, IReadOnlyDictionary<string, PartDto>?> rule)
        => rule
            .Must(parts => parts is null
                           || (parts.Count <= MaxParts
                               && parts.Values.All(p => p?.Notes is null || p.Notes.Count <= MaxNotesPerPart)))
            .WithMessage($"A sheet can hold up to {MaxParts} parts of {MaxNotesPerPart:N0} notes each.");
}
