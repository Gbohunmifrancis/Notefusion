using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Blog;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The website's public blog data: every live post for the static build (<c>published</c>), and read counts
/// for the blog and hymn pages. Anonymous, because the pages are public and the
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

    /// <summary>
    /// <c>GET /api/blog/published</c> → <c>{ version, posts: [{ slug, title, dek, description, seoTitle,
    /// seoDescription, date, updated, author, tags, keyword, cover, faq, body }] }</c>: every live post with its
    /// Markdown, newest first. The website's build (<c>tools/blog/build.mjs --api</c>) renders the blog from it at
    /// deploy time. Public: it holds nothing that is not on the site. <c>version</c> is also the ETag, so a
    /// repeat with <c>If-None-Match</c> is a 304.
    /// </summary>
    [HttpGet("published")]
    [EnableRateLimiting(AuthRateLimiting.BlogReads)]
    public async Task<IActionResult> Published(CancellationToken ct)
    {
        var result = await _sender.Send(new GetPublishedBlogPostsQuery(), ct);
        if (result.IsFailure)
            return HandleResult(result);
        var etag = $"\"{result.Value.Version}\"";
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = "public, max-age=30";
        if (Request.Headers.IfNoneMatch.Any(v => v == etag))
            return StatusCode(StatusCodes.Status304NotModified);
        return Ok(result.Value);
    }
}
