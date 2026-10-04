using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Preview.Commands;

/// <summary>
/// An anonymous thirty-second preview of a recording or file, from the website, with no account.
/// Throttled per browser and per address; the worker transcribes only the head of the clip.
/// </summary>
/// <param name="Separate">A whole song with instruments behind the voice: isolate the vocal first (see <see cref="TranscribeOptions.Separate"/>).</param>
/// <param name="Mode">What was recorded: a tune, a choir, a keyboard playing chords (see <see cref="TranscriptionMode"/>).</param>
/// <param name="KeyboardTranspose">The player's keyboard transpose setting. See <see cref="TranscribeOptions.KeyboardTranspose"/>.</param>
public sealed record SubmitPreviewCommand(
    Stream Audio,
    string FileName,
    bool Separate = false,
    bool AudioPreview = true,
    TranscriptionMode Mode = TranscriptionMode.Melody,
    int KeyboardTranspose = 0) : IRequest<Result<string>>;

/// <summary>The same preview for a song behind a YouTube, Spotify or Apple Music link.</summary>
/// <param name="KeyboardTranspose">The player's keyboard transpose setting. See <see cref="TranscribeOptions.KeyboardTranspose"/>.</param>
/// <param name="StartSeconds">Where in the song to start, in seconds; null is the start. See <see cref="TranscribeOptions.StartSeconds"/>.</param>
/// <param name="EndSeconds">Where in the song to stop, in seconds; null runs to the thirty seconds. See <see cref="TranscribeOptions.EndSeconds"/>.</param>
public sealed record SubmitPreviewLinkCommand(
    string Url, bool AudioPreview = true, int KeyboardTranspose = 0, double? StartSeconds = null, double? EndSeconds = null) : IRequest<Result<string>>;

internal static class PreviewThrottle
{
    public static async Task<Error?> CheckAsync(
        IApplicationDbContext db, string? device, string? ip, DateTime utcNow, CancellationToken ct)
    {
        var since = utcNow.AddDays(-1);
        if (device is not null)
        {
            var used = await db.PreviewJobs.CountAsync(p => p.DeviceFingerprint == device && p.CreatedAtUtc >= since, ct);
            if (used >= PreviewLimits.PerDevicePerDay) return TranscriptionErrors.PreviewLimitReached;
        }
        if (ip is not null)
        {
            var used = await db.PreviewJobs.CountAsync(p => p.Ip == ip && p.CreatedAtUtc >= since, ct);
            if (used >= PreviewLimits.PerAddressPerDay) return TranscriptionErrors.PreviewLimitReached;
        }
        return null;
    }

    public static TranscribeOptions Options => new() { MaxSeconds = PreviewLimits.Seconds };
}

public sealed class SubmitPreviewCommandHandler : IRequestHandler<SubmitPreviewCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly IClientIpAddress _ip;

    public SubmitPreviewCommandHandler(ITranscriptionApi api, IApplicationDbContext db, IDateTimeProvider clock, IDeviceFingerprint device, IClientIpAddress ip)
    {
        _api = api;
        _db = db;
        _clock = clock;
        _device = device;
        _ip = ip;
    }

    public async Task<Result<string>> Handle(SubmitPreviewCommand request, CancellationToken cancellationToken)
    {
        if (Math.Abs(request.KeyboardTranspose) > TranscribeOptions.MaxKeyboardTranspose)
            return TranscriptionErrors.InvalidKeyboardTranspose;

        var device = _device.Current;
        var ip = _ip.Current;
        if (await PreviewThrottle.CheckAsync(_db, device, ip, _clock.UtcNow, cancellationToken) is { } refused)
            return refused;

        var options = PreviewThrottle.Options with
        {
            Mode = request.Mode,
            Separate = request.Separate,
            AudioPreview = request.AudioPreview,
            KeyboardTranspose = request.KeyboardTranspose
        };
        var submitted = await _api.SubmitAsync(request.Audio, request.FileName, options, cancellationToken);
        if (submitted.IsFailure)
            return submitted;

        _db.PreviewJobs.Add(PreviewJob.Record(submitted.Value, "upload", device, ip, _clock.UtcNow));
        await _db.SaveChangesAsync(cancellationToken);
        return submitted;
    }
}

public sealed class SubmitPreviewLinkCommandHandler : IRequestHandler<SubmitPreviewLinkCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly IClientIpAddress _ip;

    public SubmitPreviewLinkCommandHandler(ITranscriptionApi api, IApplicationDbContext db, IDateTimeProvider clock, IDeviceFingerprint device, IClientIpAddress ip)
    {
        _api = api;
        _db = db;
        _clock = clock;
        _device = device;
        _ip = ip;
    }

    public async Task<Result<string>> Handle(SubmitPreviewLinkCommand request, CancellationToken cancellationToken)
    {
        // Only the link goes on, not the words a share sheet wrapped around it.
        if (!SongLinks.TryExtract(request.Url, out var url))
            return TranscriptionErrors.InvalidLink;
        if (Math.Abs(request.KeyboardTranspose) > TranscribeOptions.MaxKeyboardTranspose)
            return TranscriptionErrors.InvalidKeyboardTranspose;

        var device = _device.Current;
        var ip = _ip.Current;
        if (await PreviewThrottle.CheckAsync(_db, device, ip, _clock.UtcNow, cancellationToken) is { } refused)
            return refused;

        var section = await SongSections.ChooseAsync(_api, url, request.StartSeconds, request.EndSeconds, PreviewLimits.Seconds, cancellationToken);
        if (section.IsFailure)
            return Result.Failure<string>(section.Error);

        var options = PreviewThrottle.Options with
        {
            AudioPreview = request.AudioPreview,
            KeyboardTranspose = request.KeyboardTranspose,
            StartSeconds = section.Value.StartSeconds,
            EndSeconds = section.Value.EndSeconds
        };
        var submitted = await _api.SubmitLinkAsync(url, options, cancellationToken);
        if (submitted.IsFailure)
            return submitted;

        _db.PreviewJobs.Add(PreviewJob.Record(submitted.Value, "link", device, ip, _clock.UtcNow));
        await _db.SaveChangesAsync(cancellationToken);
        return submitted;
    }
}
