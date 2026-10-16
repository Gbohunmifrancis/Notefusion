using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Blog;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Blog;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Read counts for the website's blog and hymn pages. Anonymous, because the pages are public and the
/// count is shown to every reader; rate-limited per address and cached for a few minutes per page
/// (<see cref="BlogReadsCache"/>), because it is a database count anyone can ask for.
/// </summary>
[AllowAnonymous]
[Route("api/blog")]
public sealed class BlogController : ApiControllerBase
{
    private readonly ISender _sender;
    private readonly BlogReadsCache _cache;

    public BlogController(ISender sender, BlogReadsCache cache)
    {
        _sender = sender;
        _cache = cache;
    }

    /// <summary>
    /// <c>GET /api/blog/reads?paths=/blog/a,/hymns/b</c> → <c>{ "/blog/a": 123, "/hymns/b": 0 }</c>: the
    /// unique readers of each page (see <c>GetBlogReadsQuery</c>), keyed by the path as the tracker records
    /// it (lowercase, no trailing slash). Paths outside /blog/ and /hymns/ are left out of the answer; more
    /// than 50 is a 422.
    /// </summary>
    [HttpGet("reads")]
    [EnableRateLimiting(AuthRateLimiting.BlogReads)]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> Reads([FromQuery] string? paths, CancellationToken ct)
    {
        var parsed = BlogReadPaths.Parse(paths);
        if (parsed.IsFailure)
            return HandleResult(parsed);
        return HandleResult(await _cache.GetAsync(parsed.Value, _sender, ct));
    }
}
