using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.WebPreview;

public sealed record SubmitWebPreviewCommand(
    Stream Audio,
    string FileName,
    TranscriptionMode Mode,
    string? Key,
    int? Tempo,
    string? TimeSignature) : MediatR.IRequest<Result<WebPreviewJobDto>>;

public sealed class SubmitWebPreviewCommandHandler : MediatR.IRequestHandler<SubmitWebPreviewCommand, Result<WebPreviewJobDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly IDeviceFingerprint _device;
    private readonly IDateTimeProvider _clock;
    private readonly WebPreviewSettings _settings;

    public SubmitWebPreviewCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        IDeviceFingerprint device,
        IDateTimeProvider clock,
        WebPreviewSettings settings)
    {
        _api = api;
        _db = db;
        _device = device;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<WebPreviewJobDto>> Handle(
        SubmitWebPreviewCommand request,
        CancellationToken cancellationToken)
    {
        if (!_settings.Enabled)
            return WebPreviewErrors.Disabled;

        if (request.Audio.CanSeek && request.Audio.Length > _settings.MaxUploadBytes)
            return TranscriptionErrors.InvalidAudio;

        var now = _clock.UtcNow;
        var expiredJobs = await _db.WebPreviewJobs
            .Where(j => j.ExpiresAtUtc <= now)
            .ToListAsync(cancellationToken);
        if (expiredJobs.Count > 0)
            _db.WebPreviewJobs.RemoveRange(expiredJobs);

        var fingerprint = _device.Current;
        if (fingerprint is not null)
        {
            var since = now.AddHours(-24);
            var used = await _db.WebPreviewJobs
                .CountAsync(j => j.DeviceFingerprint == fingerprint && j.CreatedAtUtc >= since, cancellationToken);
            if (used >= _settings.DailyAllowance)
                return WebPreviewErrors.QuotaReached(_settings.DailyAllowance);
        }

        var options = new TranscribeOptions
        {
            Mode = request.Mode,
            Key = string.IsNullOrWhiteSpace(request.Key) || request.Key.Equals("Auto", StringComparison.OrdinalIgnoreCase)
                ? null
                : request.Key.Trim(),
            Tempo = request.Tempo,
            TimeSignature = request.TimeSignature
        };

        var submitted = await _api.SubmitPreviewAsync(
            request.Audio,
            request.FileName,
            options,
            _settings.MaxClipSeconds,
            cancellationToken);
        if (submitted.IsFailure)
            return submitted.Error;

        var token = WebPreviewToken.Create();
        var expires = now.AddHours(_settings.RetentionHours);
        _db.WebPreviewJobs.Add(WebPreviewJob.Record(
            submitted.Value,
            WebPreviewToken.Hash(token),
            fingerprint,
            now,
            expires));
        await _db.SaveChangesAsync(cancellationToken);

        return new WebPreviewJobDto(
            submitted.Value,
            token,
            TranscriptionStatus.Pending,
            0,
            expires);
    }
}
