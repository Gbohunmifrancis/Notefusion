using System.Net;
using CloudinaryDotNet;
using CloudinaryDotNet.Actions;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Cloudinary-backed avatar storage. The upload is signed here, server-side, from
/// <see cref="CloudinarySettings.ApiSecret"/>; the mobile client only ever sees the resulting URL.
/// </summary>
internal sealed class CloudinaryImageStorage : IImageStorage
{
    /// <summary>
    /// Square, face-aware, and capped well under the 500-character URL column: the stored asset is
    /// already the avatar, so the app renders the URL as-is with no delivery transform to get wrong.
    /// </summary>
    private const int AvatarSize = 512;

    private readonly Cloudinary _cloudinary;
    private readonly CloudinarySettings _settings;
    private readonly ILogger<CloudinaryImageStorage> _logger;

    public CloudinaryImageStorage(CloudinarySettings settings, ILogger<CloudinaryImageStorage> logger)
    {
        _settings = settings;
        _logger = logger;
        _cloudinary = new Cloudinary(new Account(settings.CloudName, settings.ApiKey, settings.ApiSecret));
        _cloudinary.Api.Secure = true;
    }

    public async Task<Result<string>> UploadAvatarAsync(
        Stream content, string fileName, Guid userId, CancellationToken ct)
    {
        try
        {
            var upload = new ImageUploadParams
            {
                File = new FileDescription(fileName, content),
                PublicId = PublicIdFor(userId),

                // The public id is derived from the user, so every upload lands on the same object.
                // Overwrite replaces the bytes; Invalidate purges the CDN copy — without it the
                // stable URL keeps serving the previous photo for as long as the edge caches it.
                Overwrite = true,
                Invalidate = true,
                UniqueFilename = false,
                UseFilename = false,

                // An incoming transformation: Cloudinary crops before storing, so there is exactly
                // one derived asset per user rather than one per delivery variant.
                Transformation = new Transformation()
                    .Width(AvatarSize).Height(AvatarSize)
                    .Crop("fill").Gravity("face")
                    .Quality("auto"),
            };

            var result = await _cloudinary.UploadAsync(upload, ct);

            if (result.Error is not null || result.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.Created))
            {
                _logger.LogError(
                    "[cloudinary] avatar upload failed for {UserId}: {Status} {Message}",
                    userId, result.StatusCode, result.Error?.Message);
                return UserErrors.PictureUploadFailed;
            }

            var url = result.SecureUrl?.ToString();
            if (string.IsNullOrWhiteSpace(url))
            {
                _logger.LogError("[cloudinary] avatar upload for {UserId} returned no URL.", userId);
                return UserErrors.PictureUploadFailed;
            }

            return url;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The network is the expected failure here, and it must reach the user as a retryable
            // message rather than a 500 — this is the market the PRD calls out for connectivity.
            _logger.LogError(ex, "[cloudinary] avatar upload threw for {UserId}.", userId);
            return UserErrors.PictureUploadFailed;
        }
    }

    public async Task DeleteAvatarAsync(Guid userId, CancellationToken ct)
    {
        try
        {
            // No cancellable overload on DestroyAsync; the call is best-effort and sub-second.
            var result = await _cloudinary.DestroyAsync(new DeletionParams(PublicIdFor(userId))
            {
                Invalidate = true,
            });

            // "not found" is the normal answer when the picture came from Google and was never ours.
            if (result.Error is not null)
            {
                _logger.LogInformation(
                    "[cloudinary] avatar delete for {UserId} returned {Message}",
                    userId, result.Error.Message);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallowed by contract: the profile record is already cleared, so the user has what
            // they asked for. A stranded object is a cleanup job, not a failed request.
            _logger.LogWarning(ex, "[cloudinary] avatar delete threw for {UserId}.", userId);
        }
    }

    /// <summary>One object per user, so a replacement overwrites rather than accumulating.</summary>
    private string PublicIdFor(Guid userId) => $"{_settings.Folder.Trim('/')}/{userId:N}";
}
