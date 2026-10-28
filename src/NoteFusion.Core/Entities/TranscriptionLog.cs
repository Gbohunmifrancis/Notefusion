using NoteFusion.Core.Seedwork;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One transcription someone asked for, saved to the library or not: what was sent (the file's name,
/// type and size, or the link), the settings it was sent with, and how it ended. The dashboard's activity
/// log reads it; the audio itself is never kept anywhere.
/// </summary>
/// <remarks>
/// Written at submit, by the same handlers that write <see cref="TranscriptionJob"/> and
/// <see cref="PreviewJob"/>, and completed by whichever path first sees the job end (a client poll, the
/// completion sweep, a preview poll). A submission the API refused before the worker saw it is kept too,
/// with no job id, because "uploads keep failing" is exactly what the log is for. Deleted after
/// <see cref="RetentionDays"/> days.
/// </remarks>
public class TranscriptionLog : BaseEntity
{
    public const int RetentionDays = 180;

    public const string AccountOrigin = "account";
    public const string PreviewOrigin = "preview";

    public const string Submitted = "submitted";
    public const string Refused = "refused";
    public const string Done = "done";
    public const string Failed = "failed";

    public const int FileNameMaxLength = 255;
    public const int ContentTypeMaxLength = 100;
    public const int UrlMaxLength = 500;
    public const int TextMaxLength = 200;
    public const int ReasonMaxLength = 500;

    private TranscriptionLog() { } // EF Core

    /// <summary>The worker's job id; null when the API refused the submission before the worker saw it.</summary>
    public string? JobId { get; private set; }

    /// <summary>The signed-in account; null for an anonymous website preview.</summary>
    public Guid? UserId { get; private set; }

    /// <summary>The device, as the same one-way hash the trial ledger and the web tracker use.</summary>
    public string? DeviceHash { get; private set; }

    /// <summary><see cref="AccountOrigin"/> or <see cref="PreviewOrigin"/> (the website's try-it-free).</summary>
    public string Origin { get; private set; } = AccountOrigin;

    /// <summary>"web", "app" or "unknown", from the request that submitted it.</summary>
    public string Client { get; private set; } = "unknown";

    /// <summary>"upload" (a recording or file), "song" (a file with instruments, voice isolated), "score" or "link".</summary>
    public string Kind { get; private set; } = "upload";

    /// <summary>The transcription mode asked for: melody, poly, choir or chords.</summary>
    public string Mode { get; private set; } = "melody";

    public string? FileName { get; private set; }
    public string? ContentType { get; private set; }
    public long? SizeBytes { get; private set; }

    public string? LinkUrl { get; private set; }

    public string? KeyRequested { get; private set; }
    public int? TempoRequested { get; private set; }
    public string? TimeSignatureRequested { get; private set; }
    public double? StartSeconds { get; private set; }
    public double? EndSeconds { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary><see cref="Submitted"/>, <see cref="Refused"/>, <see cref="Done"/> or <see cref="Failed"/>.</summary>
    public string Status { get; private set; } = Submitted;

    /// <summary>Why it was refused or failed, in the words the user was shown.</summary>
    public string? FailureReason { get; private set; }

    /// <summary>
    /// Where it stopped: this API's <c>gate</c> (an allowance or plan) or <c>request</c> (a bad setting), or the worker's
    /// <c>parse</c>, <c>resolve</c>, <c>metadata</c>, <c>search</c>, <c>download</c>, <c>decode</c>, <c>separation</c>,
    /// <c>transcription</c>, or <c>worker</c> for a job it lost. Null for one that did not stop.
    /// </summary>
    public string? FailureStage { get; private set; }

    /// <summary>The reason in one word (blocked, unavailable, no_match, low_confidence, job_lost…), for counting.</summary>
    public string? FailureCode { get; private set; }

    public const int StageMaxLength = 20;
    public const int CodeMaxLength = 60;

    public DateTime? FinishedAtUtc { get; private set; }

    /// <summary>How much audio was transcribed, in seconds, as the worker measured it.</summary>
    public double? AudioSeconds { get; private set; }

    public string? DetectedKey { get; private set; }
    public int? DetectedTempo { get; private set; }
    public int? NoteCount { get; private set; }
    public double? Confidence { get; private set; }

    /// <summary>A linked song's title and artist, as the platform reported them.</summary>
    public string? SongTitle { get; private set; }
    public string? SongArtist { get; private set; }

    /// <summary>The platform refused the song and the store's 30-second preview was transcribed instead.</summary>
    public bool UsedStorePreview { get; private set; }

    /// <summary>What a submission was, before anyone knows how it ends. Strings are clipped to their columns.</summary>
    public sealed record Request(
        string Origin,
        Guid? UserId,
        string? DeviceHash,
        string Client,
        string Kind,
        string Mode,
        string? FileName = null,
        string? ContentType = null,
        long? SizeBytes = null,
        string? LinkUrl = null,
        string? KeyRequested = null,
        int? TempoRequested = null,
        string? TimeSignatureRequested = null,
        double? StartSeconds = null,
        double? EndSeconds = null);

    public static TranscriptionLog Accept(string jobId, Request request, DateTime utcNow)
        => Create(Clip(jobId, 100), request, utcNow, Submitted, null);

    public static TranscriptionLog Refuse(Request request, string reason, DateTime utcNow, string? stage = null, string? code = null)
    {
        var log = Create(null, request, utcNow, Refused, Clip(reason, ReasonMaxLength));
        log.FailureStage = Clip(stage, StageMaxLength);
        log.FailureCode = Clip(code, CodeMaxLength);
        return log;
    }

    /// <summary>Idempotent: the first terminal observation wins, as with the job rows.</summary>
    public bool Finish(
        DateTime utcNow, double? audioSeconds, string? key, int? tempo, int? noteCount, double? confidence,
        string? songTitle, string? songArtist, bool usedStorePreview)
    {
        if (Status != Submitted) return false;
        Status = Done;
        FinishedAtUtc = utcNow;
        AudioSeconds = audioSeconds is > 0 ? Math.Round(audioSeconds.Value, 1) : null;
        DetectedKey = Clip(key, 40);
        DetectedTempo = tempo;
        NoteCount = noteCount;
        Confidence = confidence is null ? null : Math.Round(confidence.Value, 3);
        SongTitle = Clip(songTitle, TextMaxLength);
        SongArtist = Clip(songArtist, TextMaxLength);
        UsedStorePreview = usedStorePreview;
        return true;
    }

    /// <summary>Idempotent, like <see cref="Finish"/>.</summary>
    public bool Fail(DateTime utcNow, string? reason, string? stage = null, string? code = null)
    {
        if (Status != Submitted) return false;
        Status = Failed;
        FinishedAtUtc = utcNow;
        FailureReason = Clip(reason, ReasonMaxLength);
        FailureStage = Clip(stage, StageMaxLength);
        FailureCode = Clip(code, CodeMaxLength);
        return true;
    }

    private static TranscriptionLog Create(string? jobId, Request r, DateTime utcNow, string status, string? reason)
        => new()
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = r.UserId,
            DeviceHash = Clip(r.DeviceHash, 64),
            Origin = r.Origin == PreviewOrigin ? PreviewOrigin : AccountOrigin,
            Client = r.Client is "web" or "app" ? r.Client : "unknown",
            Kind = Clip(r.Kind, 10) ?? "upload",
            Mode = Clip(r.Mode, 10) ?? "melody",
            FileName = Clip(r.FileName, FileNameMaxLength),
            ContentType = Clip(r.ContentType, ContentTypeMaxLength),
            SizeBytes = r.SizeBytes is > 0 ? r.SizeBytes : null,
            LinkUrl = Clip(r.LinkUrl, UrlMaxLength),
            KeyRequested = Clip(r.KeyRequested, 40),
            TempoRequested = r.TempoRequested,
            TimeSignatureRequested = Clip(r.TimeSignatureRequested, 10),
            StartSeconds = r.StartSeconds,
            EndSeconds = r.EndSeconds,
            CreatedAtUtc = utcNow,
            Status = status,
            FailureReason = reason,
            FinishedAtUtc = status == Refused ? utcNow : null
        };

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}
