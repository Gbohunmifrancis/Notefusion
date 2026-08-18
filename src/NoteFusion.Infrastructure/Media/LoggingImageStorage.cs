using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Default <see cref="IImageStorage"/> used in development: logs the upload instead of performing it
/// and hands back a placeholder URL. Mirrors <c>LoggingEmailTransport</c> / <c>LoggingPushSender</c> —
/// <c>docker compose up</c> needs no Cloudinary account, and nobody burns a real quota while the
/// avatar flow is being tested.
/// </summary>
/// <remarks>
/// The URL it returns does not resolve, so the picture renders blank in the app. That is the honest
/// signal that no storage is configured; the alternative — a stock image from some third party —
/// would look like a working upload.
/// </remarks>
internal sealed class LoggingImageStorage : IImageStorage
{
    private readonly ILogger<LoggingImageStorage> _logger;

    public LoggingImageStorage(ILogger<LoggingImageStorage> logger) => _logger = logger;

    public Task<Result<string>> UploadAvatarAsync(
        Stream content, string fileName, Guid userId, CancellationToken ct)
    {
        // CanSeek is false for a live request stream, so the length is only sometimes knowable.
        var size = content.CanSeek ? $"{content.Length} bytes" : "unknown size";

        _logger.LogWarning(
            "[image] no Cloudinary account configured — avatar for {UserId} was not stored "
            + "({FileName}, {Size}). Set Cloudinary__UseCloudinary=true plus credentials to enable uploads.",
            userId, fileName, size);

        return Task.FromResult<Result<string>>($"https://images.invalid/notefusion/avatars/{userId:N}.jpg");
    }

    public Task DeleteAvatarAsync(Guid userId, CancellationToken ct)
    {
        _logger.LogInformation("[image] avatar delete for {UserId} (no-op, storage not configured).", userId);
        return Task.CompletedTask;
    }
}
