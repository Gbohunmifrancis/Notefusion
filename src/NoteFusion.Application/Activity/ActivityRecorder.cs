using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity;

/// <summary>
/// Writes the activity log (<see cref="TranscriptionLog"/>): one row per transcription asked for, with the
/// caller's account, device and client filled in from the request in flight.
/// </summary>
/// <remarks>
/// The submit handlers call <see cref="AcceptedAsync"/> or <see cref="RefusedAsync"/> once they know how the
/// submit went; the paths that see a job end call <see cref="FinishAsync"/> or <see cref="FailAsync"/>. Logging
/// is never allowed to change the answer the user gets, so the submit handlers call it after their own work
/// is committed.
/// </remarks>
public sealed class ActivityRecorder
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly IClientApp _client;
    private readonly ICurrentUser _currentUser;

    public ActivityRecorder(
        IApplicationDbContext db, IDateTimeProvider clock, IDeviceFingerprint device, IClientApp client, ICurrentUser currentUser)
    {
        _db = db;
        _clock = clock;
        _device = device;
        _client = client;
        _currentUser = currentUser;
    }

    /// <summary>A submission as the log describes it; the account, device and client come from the request.</summary>
    public TranscriptionLog.Request Describe(
        string origin, string kind, TranscriptionMode mode,
        string? fileName = null, string? contentType = null, long? sizeBytes = null, string? linkUrl = null,
        string? key = null, int? tempo = null, string? timeSignature = null,
        double? startSeconds = null, double? endSeconds = null)
        => new(
            origin,
            origin == TranscriptionLog.PreviewOrigin ? null : _currentUser.UserId,
            _device.Current,
            _client.Current ?? "unknown",
            kind,
            mode.ToString().ToLowerInvariant(),
            fileName, contentType, sizeBytes, linkUrl, key, tempo, timeSignature, startSeconds, endSeconds);

    /// <summary>Logs a submission the worker accepted, then commits.</summary>
    public async Task AcceptedAsync(string jobId, TranscriptionLog.Request request, CancellationToken ct)
    {
        _db.TranscriptionLogs.Add(TranscriptionLog.Accept(jobId, request, _clock.UtcNow));
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>Logs a submission that was refused, with the reason the user was given, then commits.</summary>
    public async Task RefusedAsync(TranscriptionLog.Request request, Error error, CancellationToken ct)
    {
        _db.TranscriptionLogs.Add(TranscriptionLog.Refuse(request, $"{error.Code}: {error.Message}", _clock.UtcNow));
        await _db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Records a finished job's outcome on its log row, when there is one. Does not commit: every caller is
    /// already about to save the job row it settled.
    /// </summary>
    public static async Task FinishAsync(
        IApplicationDbContext db, string jobId, TranscriptionResultDto result, DateTime utcNow, CancellationToken ct)
    {
        var log = await db.TranscriptionLogs.FirstOrDefaultAsync(l => l.JobId == jobId, ct);
        if (log is null)
            return;

        var source = result.Source;
        var transcribed = source is { StartSeconds: { } start, EndSeconds: { } end } && end > start
            ? end - start
            : result.SongDurationSec;

        log.Finish(
            utcNow, transcribed, result.Key, result.Tempo, result.Notes.Count, result.OverallConfidence,
            source?.Title, source?.Artist, source?.Preview == true);
    }

    /// <summary>Records a failed job on its log row, when there is one. Does not commit, like <see cref="FinishAsync"/>.</summary>
    public static async Task FailAsync(
        IApplicationDbContext db, string jobId, string? reason, DateTime utcNow, CancellationToken ct)
    {
        var log = await db.TranscriptionLogs.FirstOrDefaultAsync(l => l.JobId == jobId, ct);
        log?.Fail(utcNow, reason);
    }
}
