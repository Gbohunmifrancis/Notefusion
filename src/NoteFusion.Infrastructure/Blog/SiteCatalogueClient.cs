using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Blog;

/// <summary>The last catalogue read, shared by every request (the typed client is transient).</summary>
internal sealed class BlogCatalogueCache
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private readonly object _gate = new();
    private (BlogCatalogue Catalogue, DateTime At)? _entry;

    public BlogCatalogue? Get(DateTime now)
    {
        lock (_gate)
            return _entry is { } e && now - e.At < Lifetime ? e.Catalogue : null;
    }

    public void Set(BlogCatalogue catalogue, DateTime now)
    {
        lock (_gate)
            _entry = (catalogue, now);
    }
}

/// <summary>
/// Reads <c>{Blog__SiteUrl}/blog/catalogue.json</c>, which the website's build writes from its hymns (with the
/// engine's solfa), its pages and its authors. Cached ten minutes: it only changes when the site is deployed.
/// </summary>
internal sealed class SiteCatalogueClient : IBlogSiteCatalogue
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly BlogSettings _settings;
    private readonly BlogCatalogueCache _cache;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<SiteCatalogueClient> _logger;

    public SiteCatalogueClient(HttpClient http, BlogSettings settings, BlogCatalogueCache cache, IDateTimeProvider clock, ILogger<SiteCatalogueClient> logger)
    {
        _http = http;
        _settings = settings;
        _cache = cache;
        _clock = clock;
        _logger = logger;
    }

    public async Task<Result<BlogCatalogue>> GetAsync(CancellationToken ct)
    {
        if (_cache.Get(_clock.UtcNow) is { } cached)
            return cached;

        var url = _settings.SiteUrl.TrimEnd('/') + "/blog/catalogue.json";
        try
        {
            using var response = await _http.GetAsync(url, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("The site's blog catalogue answered {Status}.", (int)response.StatusCode);
                return Error.Network("BLOG_CATALOGUE_UNAVAILABLE", $"The site's catalogue ({url}) answered {(int)response.StatusCode}.");
            }
            var catalogue = JsonSerializer.Deserialize<BlogCatalogue>(await response.Content.ReadAsStringAsync(ct), Json);
            if (catalogue is null || catalogue.Hymns is null || catalogue.Pages is null)
                return Error.Failure("BLOG_CATALOGUE_INVALID", "The site's catalogue is not in the expected shape.");
            if (catalogue.Authors is null || catalogue.Authors.Count == 0)
                catalogue = catalogue with { Authors = [Core.Entities.BlogPost.DefaultAuthor] };
            _cache.Set(catalogue, _clock.UtcNow);
            return catalogue;
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return OutboundFailure.ToError(ex, "BLOG_CATALOGUE_UNAVAILABLE", "The website");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not read the site's blog catalogue: {Message}", ex.Message);
            return Error.Network("BLOG_CATALOGUE_UNAVAILABLE", "Could not reach the website to read its catalogue.");
        }
        catch (JsonException ex)
        {
            _logger.LogWarning("The site's blog catalogue is not valid JSON: {Message}", ex.Message);
            return Error.Failure("BLOG_CATALOGUE_INVALID", "The site's catalogue is not valid JSON.");
        }
    }
}
