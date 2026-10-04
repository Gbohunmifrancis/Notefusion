using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions;

/// <summary>The part of a linked song to transcribe; both null means the start of the song, up to the cap.</summary>
public readonly record struct SongSection(double? StartSeconds, double? EndSeconds);

/// <summary>
/// Checks the section a user picked of a linked song against what they may have: it starts in the song,
/// ends after it starts, and is no longer than their allowance. An end past the song's length is pulled
/// back to the length when the length is known — the picker is drawn from the same figure, so this only
/// catches a stale or hand-typed end — and nothing is checked when no section was chosen.
/// </summary>
public static class SongSections
{
    public static async Task<Result<SongSection>> ChooseAsync(
        ITranscriptionApi api, string url, double? startSeconds, double? endSeconds, double maxSeconds, CancellationToken ct)
    {
        if (startSeconds is null && endSeconds is null)
            return new SongSection(null, null);

        var start = startSeconds ?? 0;
        // JSON admits 1e999, which arrives as infinity and is not "before the song".
        if (!double.IsFinite(start))
            return TranscriptionErrors.SectionOutsideTheSong;
        if (start < 0)
            return TranscriptionErrors.SectionStartsBeforeTheSong;
        if (endSeconds is null)
            return new SongSection(start, null);

        var end = endSeconds.Value;
        if (end <= start)
            return TranscriptionErrors.SectionEndsBeforeItStarts;

        // The length is a courtesy, not a condition: a worker that cannot answer right now still gets the
        // job, and trims the section itself.
        var resolved = await api.ResolveLinkAsync(url, ct);
        if (resolved.IsSuccess && resolved.Value.DurationSeconds is { } length)
        {
            if (start >= length)
                return TranscriptionErrors.SectionOutsideTheSong;
            if (end > length)
                end = length;
        }

        if (end - start > maxSeconds)
            return TranscriptionErrors.SectionTooLong(maxSeconds);
        return new SongSection(start, end);
    }

    /// <summary>Seconds as a clock reading: <c>m:ss</c>, or <c>h:mm:ss</c> from an hour.</summary>
    public static string Clock(double seconds)
    {
        var whole = (int)Math.Round(Math.Max(0, seconds));
        var (h, m, s) = (whole / 3600, whole / 60 % 60, whole % 60);
        return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{m}:{s:00}";
    }
}
