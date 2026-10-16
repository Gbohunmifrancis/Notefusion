using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Queries;

/// <summary>
/// Every live post with its full Markdown, newest first: what the website's static build renders
/// (<c>GET /api/blog/published</c>, read by <c>tools/blog/build.mjs --api</c> at deploy time). Public, since
/// everything in it is on the site anyway; drafts, scheduled and archived posts are never in it.
/// <c>Version</c> is a hash of the answer, used as its ETag.
/// </summary>
public sealed record GetPublishedBlogPostsQuery : IRequest<Result<PublishedBlogDto>>;

public sealed class GetPublishedBlogPostsQueryHandler : IRequestHandler<GetPublishedBlogPostsQuery, Result<PublishedBlogDto>>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly IApplicationDbContext _db;

    public GetPublishedBlogPostsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PublishedBlogDto>> Handle(GetPublishedBlogPostsQuery request, CancellationToken ct)
    {
        var posts = await _db.BlogPosts.AsNoTracking()
            .Where(p => p.Status == BlogPostStatus.Published)
            .ToListAsync(ct);
        var dtos = posts
            .OrderByDescending(p => p.PublishedAtUtc)
            .ThenBy(p => p.Slug, StringComparer.Ordinal)
            .Select(BlogMapping.ToPublished)
            .ToList();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(dtos, Json)));
        return new PublishedBlogDto(Convert.ToHexStringLower(hash)[..16], dtos);
    }
}
