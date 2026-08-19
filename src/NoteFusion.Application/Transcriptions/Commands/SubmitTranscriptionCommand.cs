using MediatR;
using Microsoft.EntityFrameworkCore;

using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Submits captured audio to the Python ML service and returns the job id to poll. The C# backend is
/// the only gateway — the client never talks to the ML service directly (architecture decision).
/// </summary>
public sealed record SubmitTranscriptionCommand(
    Stream Audio,
    string FileName,
    TranscriptionMode Mode,
    string? Key,
    int? Tempo) : IRequest<Result<string>>;

public sealed class SubmitTranscriptionCommandHandler : IRequestHandler<SubmitTranscriptionCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public SubmitTranscriptionCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<string>> Handle(SubmitTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is { } userId)
        {
            var sub = await _db.Subscriptions
                .OrderByDescending(s => s.CurrentPeriodEndUtc)
                .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

            bool isPro = sub != null && sub.IsActiveAt(_clock.UtcNow);
            if (!isPro)
            {
                // Successful generations, not saved rows. Counting Transcriptions meant deleting one
                // handed the free slot back, so the limit was avoidable by anyone who noticed.
                var used = await _db.TranscriptionJobs
                    .CountAsync(j => j.UserId == userId && j.TrialConsumedAtUtc != null, cancellationToken);

                if (used >= FreeTier.TrialGenerations)
                {
                    return BillingErrors.FreeTierLimitReached;
                }
            }
        }
        // Normalise the optional key override:
        //   • null / whitespace        → treat as "no override"
        //   • "Auto" / "auto" / "none" → treat as "no override" (mobile UI default)
        //   • anything else            → validate with KeyParser before forwarding
        //
        // This guard must live here (not only in the HTTP client) so that direct callers
        // (tests, future gRPC, CLI) are protected just as much as the HTTP surface.
        var key = SanitiseKey(request.Key);

        if (key is not null && KeyParser.Parse(key).IsFailure)
            return TranscriptionErrors.InvalidKey;

        var options = new TranscribeOptions
        {
            Mode = request.Mode,
            Key = key,
            Tempo = request.Tempo
        };

        var submitted = await _api.SubmitAsync(request.Audio, request.FileName, options, cancellationToken);

        // Attribute the job before the id leaves the server, so the very first poll can check
        // ownership. Nothing is charged here — the audio has not been transcribed yet, and a job that
        // fails must not cost the user one of their five.
        if (submitted.IsSuccess && _currentUser.UserId is { } owner)
        {
            _db.TranscriptionJobs.Add(TranscriptionJob.Record(submitted.Value, owner, _clock.UtcNow));
            await _db.SaveChangesAsync(cancellationToken);
        }

        return submitted;
    }

    /// <summary>
    /// Returns null when the caller's key string means "no override", or the trimmed
    /// key string when it is a genuine key name that should be validated and forwarded.
    /// </summary>
    private static string? SanitiseKey(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var trimmed = raw.Trim();

        // Values the mobile UI sends when the user has not chosen a key.
        // Comparison is case-insensitive so "AUTO", "Auto", and "auto" are all handled.
        if (trimmed.Equals("Auto", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("None", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("Null", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("null", StringComparison.OrdinalIgnoreCase))
            return null;

        return trimmed;
    }
}
