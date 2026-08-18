using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Cloudflare R2-backed avatar storage over the S3-compatible API. The request is signed here,
/// server-side, from <see cref="R2Settings.SecretAccessKey"/>; the mobile client only ever sees the
/// resulting public URL.
/// </summary>
internal sealed class R2ImageStorage : IImageStorage
{
    /// <summary>
    /// A year. Safe because the URL we persist carries a version stamp, so a replaced picture is a
    /// different URL rather than a cached one waiting to expire.
    /// </summary>
    private const string CacheControl = "public, max-age=31536000, immutable";

    private readonly IAmazonS3 _client;
    private readonly R2Settings _settings;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<R2ImageStorage> _logger;

    public R2ImageStorage(R2Settings settings, IDateTimeProvider clock, ILogger<R2ImageStorage> logger)
    {
        _settings = settings;
        _clock = clock;
        _logger = logger;

        _client = new AmazonS3Client(
            new BasicAWSCredentials(settings.AccessKeyId, settings.SecretAccessKey),
            new AmazonS3Config
            {
                ServiceURL = settings.ServiceUrl,

                // R2 has one region, "auto". Setting it explicitly means SigV4 has a region to sign
                // with instead of hunting for ambient AWS_* env vars, which Heroku will not have.
                AuthenticationRegion = "auto",
            });
    }

    public async Task<Result<string>> UploadAvatarAsync(
        Stream content, string fileName, Guid userId, CancellationToken ct)
    {
        // R2 stores exactly what it is given, so the crop-and-scale that Cloudinary did on ingest
        // has to happen before the PUT.
        var avatar = AvatarImage.ToAvatarJpeg(content);
        if (avatar.IsFailure)
        {
            _logger.LogInformation(
                "[r2] avatar for {UserId} was not a decodable image ({FileName}).", userId, fileName);
            return avatar.Error;
        }

        await using var jpeg = avatar.Value;
        var key = KeyFor(userId);

        try
        {
            await _client.PutObjectAsync(
                new PutObjectRequest
                {
                    BucketName = _settings.BucketName,
                    Key = key,
                    InputStream = jpeg,
                    ContentType = "image/jpeg",
                    Headers = { CacheControl = CacheControl },

                    // R2 rejects streaming SigV4 and the trailing-checksum variants the SDK adds by
                    // default; both flags are Cloudflare's documented requirement, not a workaround.
                    // The connection is TLS, so the payload is still protected in transit.
                    DisablePayloadSigning = true,
                    DisableDefaultChecksumValidation = true,
                },
                ct);

            // The key is deterministic — one object per user, per the IImageStorage contract — so the
            // stamp is what makes a replacement visible. R2 has no equivalent of Cloudinary's
            // Invalidate, and without a changing URL the edge would keep serving the previous photo.
            var version = new DateTimeOffset(_clock.UtcNow, TimeSpan.Zero).ToUnixTimeSeconds();
            return $"{_settings.PublicBaseUrl.TrimEnd('/')}/{key}?v={version}";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The network is the expected failure here, and it must reach the user as a retryable
            // message rather than a 500 — this is the market the PRD calls out for connectivity.
            _logger.LogError(ex, "[r2] avatar upload threw for {UserId}.", userId);
            return UserErrors.PictureUploadFailed;
        }
    }

    public async Task DeleteAvatarAsync(Guid userId, CancellationToken ct)
    {
        try
        {
            // R2 answers 204 whether or not the key existed, and "never existed" is the normal case
            // when the picture came from Google and was never ours.
            await _client.DeleteObjectAsync(_settings.BucketName, KeyFor(userId), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallowed by contract: the profile record is already cleared, so the user has what
            // they asked for. A stranded object is a cleanup job, not a failed request.
            _logger.LogWarning(ex, "[r2] avatar delete threw for {UserId}.", userId);
        }
    }

    /// <summary>One object per user, so a replacement overwrites rather than accumulating.</summary>
    private string KeyFor(Guid userId) => $"{_settings.KeyPrefix.Trim('/')}/{userId:N}.jpg";
}
