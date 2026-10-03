using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Default <see cref="IImageStorage"/> when R2 is not configured: logs the upload and refuses it.
/// Mirrors <c>LoggingEmailTransport</c> / <c>LoggingPushSender</c> — <c>docker compose up</c> needs
/// no R2 bucket, and nobody writes to a real one while the avatar flow is being tested.
/// </summary>
/// <remarks>
/// It used to report success with a placeholder URL that never resolved. Production ran on this
/// sink when the R2 settings never reached the container, and every upload replaced a working
/// photo — a Google one included — with that dead URL while the app said it had saved. A refusal
/// leaves the existing photo alone and tells the user plainly that uploads are off.
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
            "[image] no R2 bucket configured — avatar for {UserId} was refused "
            + "({FileName}, {Size}). Set R2__UseR2=true plus credentials to enable uploads.",
            userId, fileName, size);

        return Task.FromResult<Result<string>>(UserErrors.PictureStorageUnavailable);
    }

    public Task DeleteAvatarAsync(Guid userId, CancellationToken ct)
    {
        _logger.LogInformation("[image] avatar delete for {UserId} (no-op, storage not configured).", userId);
        return Task.CompletedTask;
    }
}
