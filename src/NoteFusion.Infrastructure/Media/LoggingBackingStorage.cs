using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Default <see cref="IBackingStorage"/> when R2 is not configured (a local run), as <see cref="LoggingImageStorage"/>
/// is for photos: nothing is kept, so sheets are filed without a backing and a fresh job's backing still plays from
/// the worker's copy.
/// </summary>
internal sealed class LoggingBackingStorage(ILogger<LoggingBackingStorage> logger) : IBackingStorage
{
    public Task<Result<string>> SaveAsync(Guid userId, byte[] mp3, CancellationToken ct)
    {
        logger.LogInformation("[backing] no R2 bucket configured: a {Bytes}-byte backing for {UserId} was not kept.", mp3.Length, userId);
        return Task.FromResult<Result<string>>(ProviderErrors.Unavailable);
    }

    public Task<Result<byte[]>> ReadAsync(string key, CancellationToken ct)
        => Task.FromResult<Result<byte[]>>(LibraryErrors.BackingNotFound);

    public Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct) => Task.CompletedTask;

    public Task DeleteAllForUserAsync(Guid userId, CancellationToken ct) => Task.CompletedTask;
}
