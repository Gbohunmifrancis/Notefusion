using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
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
    /// <summary>
    /// How long a submit waits on the song's length. It is read again only to check a picked section, and the worker
    /// trims the section itself, so a worker slow to say never holds the job up for longer than this.
    /// </summary>
    public static readonly TimeSpan LengthWait = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The refusals that are the link's for good, so there is no section of it to take: no video there, a private or
    /// removed one, a live stream, one over the cap. "Not just now" (YouTube, Instagram or TikTok refusing a
    /// read at this moment) is not one of them: the job reads the link again itself, and a failed job costs nothing.
    /// </summary>
    public static bool IsForGood(Error refusal)
        => refusal.Code is "TRANS_LINK_NOT_FOUND" or "TRANS_LINK_UNAVAILABLE" or "TRANS_LINK_LIVE" or "TRANS_LINK_TOO_LONG"
            or "TRANS_LINK_NOT_SUPPORTED";

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

        // The length is a courtesy, not a condition: a worker that cannot answer right now (or within LengthWait)
        // still gets the job, and trims the section itself. A link the worker has turned away for good (a live
        // stream, a video over its cap, one that is private or gone) is another matter: there is no section of it.
        Result<SourceDto> resolved;
        using (var wait = CancellationTokenSource.CreateLinkedTokenSource(ct))
        {
            wait.CancelAfter(LengthWait);
            try
            {
                resolved = await api.ResolveLinkAsync(url, wait.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                resolved = TranscriptionErrors.ServiceUnavailable;
            }
        }
        if (resolved.IsFailure && IsForGood(resolved.Error))
            return Result.Failure<SongSection>(resolved.Error);
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

    /// <summary>Seconds as a length in words: "2 hours", "1 h 30 min", "45 min".</summary>
    public static string Length(double seconds)
    {
        var minutes = (int)Math.Round(Math.Max(0, seconds)) / 60;
        var (h, m) = (minutes / 60, minutes % 60);
        if (h > 0 && m > 0) return $"{h} h {m} min";
        if (h > 0) return h == 1 ? "1 hour" : $"{h} hours";
        return $"{Math.Max(1, m)} min";
    }

    /// <summary>Seconds as a clock reading: <c>m:ss</c>, or <c>h:mm:ss</c> from an hour.</summary>
    public static string Clock(double seconds)
    {
        var whole = (int)Math.Round(Math.Max(0, seconds));
        var (h, m, s) = (whole / 3600, whole / 60 % 60, whole % 60);
        return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{m}:{s:00}";
    }
}
