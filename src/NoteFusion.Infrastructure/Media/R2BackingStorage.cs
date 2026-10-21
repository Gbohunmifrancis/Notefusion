using System.Net;
using System.Security.Cryptography;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// The backings kept with sheets, in the profile photos' R2 bucket (so the same deploy settings reach it) under
/// <c>backing/{userId}/{random}.mp3</c>. That bucket is served publicly from its custom domain, so a name is 128
/// random bits that never leave the server: the API reads the bytes and hands them to the sheet's owner alone.
/// Every call goes through <see cref="Http.OutboundResilience.FileStore"/> (the S3 client is handed the pooled,
/// resilient HttpClient), and the SDK's own retries are off so the pipeline is the one that decides.
/// </summary>
internal sealed class R2BackingStorage : IBackingStorage
{
    internal const string HttpClientName = "r2-backing";
    internal const string Prefix = "backing";

    /// <summary>A closed account's files are deleted this many at a time.</summary>
    private const int DeletesAtOnce = 8;

    private readonly IAmazonS3 _client;
    private readonly R2Settings _settings;
    private readonly ILogger<R2BackingStorage> _logger;

    public R2BackingStorage(R2Settings settings, IHttpClientFactory http, ILogger<R2BackingStorage> logger)
    {
        _settings = settings;
        _logger = logger;
        _client = new AmazonS3Client(
            new BasicAWSCredentials(settings.AccessKeyId, settings.SecretAccessKey),
            new AmazonS3Config
            {
                ServiceURL = settings.ServiceUrl,
                // R2 has one region, "auto" (see R2ImageStorage).
                AuthenticationRegion = "auto",
                HttpClientFactory = new PooledHttpClients(http),
                MaxErrorRetry = 0,
                // Cloudflare's documented settings for R2: checksums only where the S3 API requires one.
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
            });
    }

    public async Task<Result<string>> SaveAsync(Guid userId, byte[] mp3, CancellationToken ct)
    {
        var key = $"{UserPrefix(userId)}{Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16))}.mp3";
        try
        {
            using var body = new MemoryStream(mp3, writable: false);
            await _client.PutObjectAsync(
                new PutObjectRequest
                {
                    BucketName = _settings.BucketName,
                    Key = key,
                    InputStream = body,
                    ContentType = "audio/mpeg",
                    // Never cached at the bucket's public edge: only the API hands these out.
                    Headers = { CacheControl = "private, no-store" },
                    // R2's requirement, as for the photos (R2ImageStorage).
                    DisablePayloadSigning = true,
                    DisableDefaultChecksumValidation = true,
                },
                ct);
            return key;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "[r2] a backing for {UserId} was not stored; the sheet is filed without it.", userId);
            return ProviderErrors.Unavailable;
        }
    }

    public async Task<Result<byte[]>> ReadAsync(string key, CancellationToken ct)
    {
        try
        {
            using var response = await _client.GetObjectAsync(_settings.BucketName, key, ct);
            using var buffer = new MemoryStream();
            await response.ResponseStream.CopyToAsync(buffer, ct);
            return buffer.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return LibraryErrors.BackingNotFound;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "[r2] a backing could not be read.");
            return ProviderErrors.Unavailable;
        }
    }

    public async Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        await Parallel.ForEachAsync(keys, new ParallelOptions { MaxDegreeOfParallelism = DeletesAtOnce, CancellationToken = ct },
            async (key, token) =>
            {
                try
                {
                    // R2 answers 204 whether or not the object was there.
                    await _client.DeleteObjectAsync(_settings.BucketName, key, token);
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                {
                    // The account's own sweep (DeleteAllForUserAsync) still finds it when the account closes.
                    _logger.LogWarning(ex, "[r2] a deleted sheet's backing was not deleted.");
                }
            });
    }

    public async Task DeleteAllForUserAsync(Guid userId, CancellationToken ct)
    {
        var keys = new List<string>();
        try
        {
            var request = new ListObjectsV2Request { BucketName = _settings.BucketName, Prefix = UserPrefix(userId) };
            do
            {
                var page = await _client.ListObjectsV2Async(request, ct);
                keys.AddRange(page.S3Objects?.Select(o => o.Key) ?? []);
                request.ContinuationToken = page.IsTruncated == true ? page.NextContinuationToken : null;
            }
            while (request.ContinuationToken is not null);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            _logger.LogError(ex, "[r2] the backings of closed account {UserId} could not be listed; they were not deleted.", userId);
            return;
        }

        await DeleteAsync(keys, ct);
    }

    /// <summary>One folder per account, so a closed account's files are found without the sheets that named them.</summary>
    internal static string UserPrefix(Guid userId) => $"{Prefix}/{userId:N}/";

    /// <summary>
    /// Hands the S3 client the named client from <see cref="IHttpClientFactory"/>, a fresh one per call (the factory
    /// pools the handlers), so every request goes through the client's resilience pipeline.
    /// </summary>
    private sealed class PooledHttpClients(IHttpClientFactory factory) : HttpClientFactory
    {
        public override HttpClient CreateHttpClient(IClientConfig clientConfig) => factory.CreateClient(HttpClientName);

        public override bool UseSDKHttpClientCaching(IClientConfig clientConfig) => false;

        public override bool DisposeHttpClientsAfterUse(IClientConfig clientConfig) => true;

        public override string GetConfigUniqueString(IClientConfig clientConfig) => HttpClientName;
    }
}
