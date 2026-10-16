using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Queries;

/// <summary>The console's posts table: filtered by status and source, searched by title, slug or keyword, newest change first.</summary>
public sealed record ListBlogPostsQuery(string? Status, string? Source, string? Search, int Page = 1, int PageSize = 50)
    : IRequest<Result<PagedResultDto<BlogPostListRowDto>>>;

public sealed class ListBlogPostsQueryHandler : IRequestHandler<ListBlogPostsQuery, Result<PagedResultDto<BlogPostListRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public ListBlogPostsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<BlogPostListRowDto>>> Handle(ListBlogPostsQuery request, CancellationToken ct)
    {
        var query = _db.BlogPosts.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!Enum.TryParse<BlogPostStatus>(request.Status, true, out var status))
                return Error.Validation("BLOG_STATUS_UNKNOWN", "Status is Draft, Scheduled, Published or Archived.");
            query = query.Where(p => p.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(request.Source))
        {
            if (!Enum.TryParse<BlogPostSource>(request.Source, true, out var source))
                return Error.Validation("BLOG_SOURCE_UNKNOWN", "Source is Manual, Gemini or Imported.");
            query = query.Where(p => p.Source == source);
        }
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var term = request.Search.Trim().ToLower();
            query = query.Where(p => p.Title.ToLower().Contains(term) || p.Slug.Contains(term) || (p.Keyword != null && p.Keyword.ToLower().Contains(term)));
        }

        var pageSize = Math.Clamp(request.PageSize, 1, 200);
        var page = Math.Max(1, request.Page);
        var total = await query.CountAsync(ct);
        var posts = await query.OrderByDescending(p => p.UpdatedAtUtc)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        var rows = posts.Select(p => new BlogPostListRowDto(
            p.Id, p.Slug, p.Title, p.Status.ToString(), p.Source.ToString(), p.Tags, p.PublishAtUtc, p.PublishedAtUtc,
            p.UpdatedAtUtc, p.CreatedAtUtc, BlogChecks.CountWords(BlogChecks.StripFences(p.Body)), p.ReviewNotes.Count,
            p.GenerationModel, p.GenerationUsage.Sum(u => u.Total), BlogMapping.PathOf(p.Slug))).ToList();
        return new PagedResultDto<BlogPostListRowDto>(rows, page, pageSize, total);
    }
}

public sealed record GetBlogPostQuery(Guid Id) : IRequest<Result<BlogPostDto>>;

public sealed class GetBlogPostQueryHandler : IRequestHandler<GetBlogPostQuery, Result<BlogPostDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly BlogSettings _settings;

    public GetBlogPostQueryHandler(IApplicationDbContext db, BlogSettings settings)
    {
        _db = db;
        _settings = settings;
    }

    public async Task<Result<BlogPostDto>> Handle(GetBlogPostQuery request, CancellationToken ct)
    {
        var post = await _db.BlogPosts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        return post is null ? BlogPostErrors.NotFound : BlogMapping.ToDto(post, _settings.SiteUrl);
    }
}

/// <summary>
/// The checks on the editor's current fields (saved or not), against the live site: what blocks publishing
/// and what is advice. The console calls it as the founder edits.
/// </summary>
public sealed record CheckBlogPostQuery(Guid? Id, BlogPostInput Input) : IRequest<Result<BlogPostCheckDto>>;

public sealed class CheckBlogPostQueryHandler : IRequestHandler<CheckBlogPostQuery, Result<BlogPostCheckDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IBlogSiteCatalogue _catalogue;

    public CheckBlogPostQueryHandler(IApplicationDbContext db, IBlogSiteCatalogue catalogue)
    {
        _db = db;
        _catalogue = catalogue;
    }

    public async Task<Result<BlogPostCheckDto>> Handle(CheckBlogPostQuery request, CancellationToken ct)
    {
        var input = BlogCheckInput.From(request.Input.CleanSlug, request.Input.ToContent());
        return await BlogPostChecking.CheckAsync(_db, _catalogue, input, request.Id ?? Guid.Empty, ct);
    }
}

/// <summary>The drafting queue, in order.</summary>
public sealed record ListBlogTopicsQuery : IRequest<Result<IReadOnlyList<BlogTopicDto>>>;

public sealed class ListBlogTopicsQueryHandler : IRequestHandler<ListBlogTopicsQuery, Result<IReadOnlyList<BlogTopicDto>>>
{
    private readonly IApplicationDbContext _db;

    public ListBlogTopicsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<IReadOnlyList<BlogTopicDto>>> Handle(ListBlogTopicsQuery request, CancellationToken ct)
    {
        var topics = await _db.BlogTopics.AsNoTracking().OrderBy(t => t.Position).ThenBy(t => t.CreatedAtUtc).ToListAsync(ct);
        return topics.Select(BlogMapping.ToDto).ToList();
    }
}

/// <summary>The newest batches of drafts (for the console's history and progress).</summary>
public sealed record ListBlogGenerationRunsQuery(int Take = 20) : IRequest<Result<IReadOnlyList<BlogGenerationRunDto>>>;

public sealed class ListBlogGenerationRunsQueryHandler : IRequestHandler<ListBlogGenerationRunsQuery, Result<IReadOnlyList<BlogGenerationRunDto>>>
{
    private readonly IApplicationDbContext _db;

    public ListBlogGenerationRunsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<IReadOnlyList<BlogGenerationRunDto>>> Handle(ListBlogGenerationRunsQuery request, CancellationToken ct)
    {
        var runs = await _db.BlogGenerationRuns.AsNoTracking().OrderByDescending(r => r.CreatedAtUtc)
            .Take(Math.Clamp(request.Take, 1, 100)).ToListAsync(ct);
        return runs.Select(BlogMapping.ToDto).ToList();
    }
}

public sealed record GetBlogGenerationRunQuery(Guid Id) : IRequest<Result<BlogGenerationRunDto>>;

public sealed class GetBlogGenerationRunQueryHandler : IRequestHandler<GetBlogGenerationRunQuery, Result<BlogGenerationRunDto>>
{
    private readonly IApplicationDbContext _db;

    public GetBlogGenerationRunQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<BlogGenerationRunDto>> Handle(GetBlogGenerationRunQuery request, CancellationToken ct)
    {
        var run = await _db.BlogGenerationRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == request.Id, ct);
        return run is null
            ? Error.NotFound("BLOG_RUN_NOT_FOUND", "There is no such batch of drafts.")
            : BlogMapping.ToDto(run);
    }
}

/// <summary>Whether rebuilds and drafting are on, the last rebuild request, and the deploy workflow's newest run.</summary>
public sealed record GetBlogSiteStatusQuery : IRequest<Result<BlogSiteStatusDto>>;

public sealed class GetBlogSiteStatusQueryHandler : IRequestHandler<GetBlogSiteStatusQuery, Result<BlogSiteStatusDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IGitHubActions _github;
    private readonly IGeminiClient _gemini;
    private readonly BlogSettings _settings;

    public GetBlogSiteStatusQueryHandler(IApplicationDbContext db, IGitHubActions github, IGeminiClient gemini, BlogSettings settings)
    {
        _db = db;
        _github = github;
        _gemini = gemini;
        _settings = settings;
    }

    public async Task<Result<BlogSiteStatusDto>> Handle(GetBlogSiteStatusQuery request, CancellationToken ct)
    {
        var pending = await _db.BlogSiteRebuilds.CountAsync(r => r.DispatchedAtUtc == null, ct);
        var last = await _db.BlogSiteRebuilds.AsNoTracking().OrderByDescending(r => r.RequestedAtUtc).FirstOrDefaultAsync(ct);
        var lastDispatched = await _db.BlogSiteRebuilds.Where(r => r.DispatchedAtUtc != null).MaxAsync(r => r.DispatchedAtUtc, ct);

        BlogDeployRunDto? deploy = null;
        if (_github.IsConfigured)
        {
            var run = await _github.LatestSiteDeployAsync(ct);
            if (run.IsSuccess && run.Value is { } r)
                deploy = new BlogDeployRunDto(r.Status, r.Conclusion, r.Url, r.CreatedAtUtc, r.Event);
        }

        var schedule = _settings.AutoDraftEnabled && _settings.AutoDraftDays.Count > 0
            ? $"{_settings.AutoDraftCount} draft(s) every {string.Join(" and ", _settings.AutoDraftDays)} at {_settings.AutoDraftTimeUtc:HH\\:mm} UTC"
            : null;
        return new BlogSiteStatusDto(
            _github.IsConfigured, _github.IsConfigured ? _github.Target : null, _gemini.IsConfigured, _settings.GeminiModel,
            _settings.SiteUrl, pending, last?.RequestedAtUtc, lastDispatched, last?.Error, deploy, schedule);
    }
}
