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
    private readonly IDeviceFingerprint _device;
    private readonly ITrialDeviceRecorder _devices;

    public SubmitTranscriptionCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IDeviceFingerprint device,
        ITrialDeviceRecorder devices)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
        _devices = devices;
    }

    public async Task<Result<string>> Handle(SubmitTranscriptionCommand request, CancellationToken cancellationToken)
    {
        // Read once: the header cannot change mid-request, and the gate below and the stamp further down
        // must agree about which handset this is or the two would count different things.
        var fingerprint = _device.Current;
        var metered = false;

        if (_currentUser.UserId is { } userId)
        {
            var sub = await _db.Subscriptions
                .OrderByDescending(s => s.CurrentPeriodEndUtc)
                .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

            bool isPro = sub != null && sub.IsActiveAt(_clock.UtcNow);
            metered = !isPro;

            if (metered)
            {
                // Successful generations, not saved rows. Counting Transcriptions meant deleting one
                // handed the free slot back, so the limit was avoidable by anyone who noticed. And counted
                // per device as well as per account, because adding a second Google account to an Android
                // phone is four taps and used to be worth five more free generations.
                var used = await TrialUsage.CountUsedAsync(_db, userId, fingerprint, cancellationToken);

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
        // fails must not cost the user one of their five. The device is stamped now rather than at
        // consume time because the poll that charges the trial may be the completion sweep, which runs
        // on a timer with no request behind it and so no header to read.
        if (submitted.IsSuccess && _currentUser.UserId is { } owner)
        {
            _db.TranscriptionJobs.Add(TranscriptionJob.Record(submitted.Value, owner, _clock.UtcNow, fingerprint));

            // Only for accounts the allowance applies to: a Pro subscriber's handset is not part of the
            // trial ledger, and registering it would spend a geo lookup to learn nothing.
            if (metered && fingerprint is not null)
            {
                await _devices.RecordAsync(fingerprint, owner, cancellationToken);
            }

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
