using MediatR;
using Microsoft.EntityFrameworkCore;

using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
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
                var count = await _db.Transcriptions.CountAsync(t => t.UserId == userId, cancellationToken);
                if (count >= 5)
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

        return await _api.SubmitAsync(request.Audio, request.FileName, options, cancellationToken);
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
