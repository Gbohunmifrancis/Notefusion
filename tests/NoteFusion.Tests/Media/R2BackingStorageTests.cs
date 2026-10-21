using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Infrastructure.Media;

namespace NoteFusion.Tests.Media;

/// <summary>
/// The backings kept with sheets, in R2, through the real S3 client handed the pooled HttpClient with the file store's
/// resilience pipeline (<see cref="OutboundResilience.FileStore"/>), against a scripted bucket: what is stored where,
/// that it reads back, that a missing one is "not found" and a refusing store "unavailable", and that a closed
/// account's whole folder is found and deleted.
/// </summary>
public class R2BackingStorageTests
{
    private static readonly byte[] Mp3 = [0xFF, 0xFB, 0x90, 0x64, 0x00, 0x0F, 0xF0, 0x01];

    [Fact]
    public async Task A_backing_is_stored_privately_under_its_owners_folder_and_reads_back()
    {
        var bucket = new FakeBucket();
        using var rig = new Rig(bucket);
        var owner = Guid.NewGuid();

        var saved = await rig.Storage.SaveAsync(owner, Mp3, default);
        var again = await rig.Storage.SaveAsync(owner, Mp3, default);
        var read = await rig.Storage.ReadAsync(saved.Value, default);

        Assert.True(saved.IsSuccess);
        Assert.Matches($"^backing/{owner:N}/[0-9a-f]{{32}}\\.mp3$", saved.Value);
        Assert.NotEqual(saved.Value, again.Value); // a new unguessable name every time
        Assert.Equal(Mp3, bucket.Objects[saved.Value]);
        Assert.Equal("audio/mpeg", bucket.ContentTypes[saved.Value]);
        Assert.True(bucket.CacheControls[saved.Value] is { Private: true, NoStore: true });
        Assert.True(read.IsSuccess, string.Join("\n", rig.Logged));
        Assert.Equal(Mp3, read.Value);
    }

    [Fact]
    public async Task A_missing_backing_is_not_found_and_a_refusing_store_is_unavailable()
    {
        var bucket = new FakeBucket();
        using var rig = new Rig(bucket);

        var missing = await rig.Storage.ReadAsync($"backing/{Guid.NewGuid():N}/gone.mp3", default);
        bucket.RefuseWrites = true;
        var refused = await rig.Storage.SaveAsync(Guid.NewGuid(), Mp3, default);

        Assert.Equal(LibraryErrors.BackingNotFound, missing.Error);
        Assert.Equal(ProviderErrors.Unavailable, refused.Error);
    }

    [Fact]
    public async Task Deleting_takes_the_named_files_and_closing_an_account_takes_its_whole_folder()
    {
        var bucket = new FakeBucket();
        using var rig = new Rig(bucket);
        var (ada, bola) = (Guid.NewGuid(), Guid.NewGuid());
        var first = (await rig.Storage.SaveAsync(ada, Mp3, default)).Value;
        var second = (await rig.Storage.SaveAsync(ada, Mp3, default)).Value;
        var stray = (await rig.Storage.SaveAsync(ada, Mp3, default)).Value;
        var bolas = (await rig.Storage.SaveAsync(bola, Mp3, default)).Value;

        await rig.Storage.DeleteAsync([first], default);
        Assert.Equal(new[] { second, stray, bolas }.Order(), bucket.Objects.Keys.Order());

        await rig.Storage.DeleteAllForUserAsync(ada, default);

        Assert.Equal([bolas], bucket.Objects.Keys);
    }

    private sealed class Rig : IDisposable
    {
        private readonly ServiceProvider _services;

        public Rig(HttpMessageHandler socket)
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddHttpClient(R2BackingStorage.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => socket)
                .AddOutboundResilience(OutboundResilience.FileStore);
            _services = services.BuildServiceProvider();
            var settings = new R2Settings
            {
                UseR2 = true,
                AccountId = "account",
                AccessKeyId = "key-id",
                SecretAccessKey = "secret",
                BucketName = "media",
                PublicBaseUrl = "https://media.example",
            };
            Storage = new R2BackingStorage(settings, _services.GetRequiredService<IHttpClientFactory>(), Log);
        }

        public R2BackingStorage Storage { get; }

        private CapturingLogger Log { get; } = new();

        /// <summary>What the store logged, exceptions included, for a failing assertion to show.</summary>
        public IReadOnlyList<string> Logged => Log.Lines;

        public void Dispose() => _services.Dispose();
    }

    private sealed class CapturingLogger : ILogger<R2BackingStorage>
    {
        public List<string> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Lines.Add($"{formatter(state, exception)} {exception}");
    }

    /// <summary>The few S3 calls the store makes (PUT, GET, list, DELETE), against objects held in memory.</summary>
    private sealed class FakeBucket : HttpMessageHandler
    {
        public Dictionary<string, byte[]> Objects { get; } = [];
        public Dictionary<string, string?> ContentTypes { get; } = [];
        public Dictionary<string, CacheControlHeaderValue?> CacheControls { get; } = [];
        public bool RefuseWrites { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            // Virtual-hosted (the bucket in the host) or path style (the bucket first in the path): the key either way.
            var key = Uri.UnescapeDataString(request.RequestUri!.AbsolutePath).TrimStart('/');
            if (!request.RequestUri.Host.StartsWith("media.", StringComparison.Ordinal) && key.StartsWith("media", StringComparison.Ordinal))
                key = key["media".Length..].TrimStart('/');
            var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri.Query);

            if (request.Method == HttpMethod.Put)
            {
                if (RefuseWrites)
                    return new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = Xml(Error("InternalError")) };
                Objects[key] = await request.Content!.ReadAsByteArrayAsync(ct);
                ContentTypes[key] = request.Content.Headers.ContentType?.MediaType;
                CacheControls[key] = request.Headers.CacheControl;
                var put = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([]) };
                put.Headers.ETag = ETag(Objects[key]);
                return put;
            }
            if (request.Method == HttpMethod.Delete)
            {
                Objects.Remove(key);
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }
            if (query["list-type"] == "2")
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = Xml(List(query["prefix"] ?? "")) };
            if (!Objects.TryGetValue(key, out var bytes))
                return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = Xml(Error("NoSuchKey")) };
            var get = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
            get.Content.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
            get.Headers.ETag = ETag(bytes);
            return get;
        }

        /// <summary>S3's ETag for a single-part object: its MD5, which the client checks the bytes against.</summary>
        private static EntityTagHeaderValue ETag(byte[] bytes)
            => new($"\"{Convert.ToHexStringLower(System.Security.Cryptography.MD5.HashData(bytes))}\"");

        private string List(string prefix)
        {
            var keys = Objects.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList();
            var contents = string.Concat(keys.Select(k =>
                $"<Contents><Key>{k}</Key><LastModified>2026-10-21T00:00:00.000Z</LastModified><ETag>\"etag\"</ETag><Size>8</Size><StorageClass>STANDARD</StorageClass></Contents>"));
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">"
                + $"<Name>media</Name><Prefix>{prefix}</Prefix><KeyCount>{keys.Count}</KeyCount><MaxKeys>1000</MaxKeys>"
                + $"<IsTruncated>false</IsTruncated>{contents}</ListBucketResult>";
        }

        private static string Error(string code)
            => $"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Error><Code>{code}</Code><Message>{code}</Message></Error>";

        private static StringContent Xml(string body) => new(body, Encoding.UTF8, "application/xml");
    }
}
