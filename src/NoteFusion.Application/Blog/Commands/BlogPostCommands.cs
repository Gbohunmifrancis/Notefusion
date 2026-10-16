using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Commands;

/// <summary>The editor's fields, as the console sends them.</summary>
public sealed record BlogPostInput(
    string Slug,
    string Title,
    string? Dek,
    string? Description,
    string? Body,
    IReadOnlyList<string>? Tags,
    string? Keyword,
    BlogCoverDto? Cover,
    IReadOnlyList<BlogFaqDto>? Faq,
    string? SeoTitle,
    string? SeoDescription,
    string? Author)
{
    /// <summary>
    /// What the database cannot hold, as one validation error. Everything else (a missing description, no
    /// tags…) is allowed in a draft and reported by the checks, which stop it only at publishing.
    /// </summary>
    public Error? Problem()
    {
        var problems = new List<string>();
        var slug = (Slug ?? string.Empty).Trim();
        if (!BlogPost.IsSlug(slug) || slug.Length > BlogPost.SlugMaxLength)
            problems.Add($"The slug must be lowercase words joined by hyphens, at most {BlogPost.SlugMaxLength} characters.");
        if (string.IsNullOrWhiteSpace(Title))
            problems.Add("Give the post a title.");
        Max(Title, BlogPost.TitleMaxLength, "The title");
        Max(Dek, BlogPost.DekMaxLength, "The line under the title");
        Max(Description, BlogPost.DescriptionMaxLength, "The description");
        Max(Body, BlogPost.BodyMaxLength, "The body");
        Max(Keyword, BlogPost.KeywordMaxLength, "The keyword");
        Max(SeoTitle, BlogPost.SeoTitleMaxLength, "The SEO title");
        Max(SeoDescription, BlogPost.SeoDescriptionMaxLength, "The SEO description");
        Max(Author, BlogPost.AuthorMaxLength, "The author");
        var tags = Tags ?? [];
        if (tags.Count > BlogPost.MaxTags || tags.Any(t => t.Trim().Length > BlogPost.TagMaxLength))
            problems.Add($"At most {BlogPost.MaxTags} tags of at most {BlogPost.TagMaxLength} characters.");
        if ((Faq?.Count ?? 0) > BlogPost.MaxFaq)
            problems.Add($"At most {BlogPost.MaxFaq} questions.");
        if (Cover is { } c)
        {
            Max(c.Src, BlogPost.CoverUrlMaxLength, "The cover address");
            Max(c.Alt, BlogPost.CoverAltMaxLength, "The cover's alt text");
            if (c.Width is < 0 or > 10_000 || c.Height is < 0 or > 10_000)
                problems.Add("The cover's width and height must be sizes in pixels.");
        }
        return problems.Count == 0 ? null : Error.Validation("BLOG_POST_INVALID", string.Join(" ", problems));

        void Max(string? value, int max, string what)
        {
            if (value is not null && value.Trim().Length > max)
                problems.Add($"{what} is {value.Trim().Length} characters; the most is {max}.");
        }
    }

    public string CleanSlug => (Slug ?? string.Empty).Trim();

    public BlogPostContent ToContent() => new(
        Title.Trim(), Dek, Description ?? string.Empty, Body ?? string.Empty,
        (Tags ?? []).Select(t => t.Trim().ToLowerInvariant()).Where(t => t.Length > 0).ToList(),
        Keyword,
        string.IsNullOrWhiteSpace(Cover?.Src) ? null : Cover!.Src.Trim(), Cover?.Alt, Cover?.Width, Cover?.Height,
        (Faq ?? []).Where(f => !string.IsNullOrWhiteSpace(f.Question) || !string.IsNullOrWhiteSpace(f.Answer))
            .Select(f => new BlogFaqItem(f.Question ?? string.Empty, f.Answer ?? string.Empty)).ToList(),
        SeoTitle, SeoDescription, string.IsNullOrWhiteSpace(Author) ? BlogPost.DefaultAuthor : Author.Trim());
}

internal static class BlogPostErrors
{
    public static readonly Error NotFound = Error.NotFound("BLOG_POST_NOT_FOUND", "There is no such post.");

    public static Error SlugTaken(string slug)
        => Error.Conflict("BLOG_SLUG_TAKEN", $"Another post already uses /blog/{slug}.");

    public static readonly Error SlugLocked = Error.Conflict(
        "BLOG_SLUG_LOCKED", "This post has been published, so its address stays as it is: people and search engines link to it.");

    public static readonly Error Stale = Error.Conflict(
        "BLOG_POST_CHANGED", "Someone saved this post since you opened it. Reload it to see their changes, then make yours again.");
}

/// <summary>A new draft, written in the console.</summary>
public sealed record CreateBlogPostCommand(BlogPostInput Input) : IRequest<Result<BlogPostDto>>;

public sealed class CreateBlogPostCommandHandler : IRequestHandler<CreateBlogPostCommand, Result<BlogPostDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BlogSettings _settings;

    public CreateBlogPostCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, BlogSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<BlogPostDto>> Handle(CreateBlogPostCommand request, CancellationToken ct)
    {
        if (request.Input.Problem() is { } problem)
            return problem;
        var slug = request.Input.CleanSlug;
        if (await _db.BlogPosts.AnyAsync(p => p.Slug == slug, ct))
            return BlogPostErrors.SlugTaken(slug);

        var post = BlogPost.Create(slug, request.Input.ToContent(), BlogPostSource.Manual, _clock.UtcNow);
        _db.BlogPosts.Add(post);
        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(post, _settings.SiteUrl);
    }
}

/// <summary>
/// Saves the editor. <c>Version</c> is the one the editor opened: an older one is a conflict, not an overwrite.
/// A change to a live post asks for a site rebuild; its slug never changes once published.
/// </summary>
public sealed record UpdateBlogPostCommand(Guid Id, int Version, BlogPostInput Input, bool ClearReviewNotes = false) : IRequest<Result<BlogPostDto>>;

public sealed class UpdateBlogPostCommandHandler : IRequestHandler<UpdateBlogPostCommand, Result<BlogPostDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BlogSettings _settings;
    private readonly IBlogSiteCatalogue _catalogue;

    public UpdateBlogPostCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, BlogSettings settings, IBlogSiteCatalogue catalogue)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
        _catalogue = catalogue;
    }

    public async Task<Result<BlogPostDto>> Handle(UpdateBlogPostCommand request, CancellationToken ct)
    {
        if (request.Input.Problem() is { } problem)
            return problem;
        var post = await _db.BlogPosts.FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (post is null)
            return BlogPostErrors.NotFound;
        if (post.Version != request.Version)
            return BlogPostErrors.Stale;

        var now = _clock.UtcNow;
        var slug = request.Input.CleanSlug;
        if (slug != post.Slug)
        {
            if (post.SlugLocked)
                return BlogPostErrors.SlugLocked;
            if (await _db.BlogPosts.AnyAsync(p => p.Slug == slug && p.Id != post.Id, ct))
                return BlogPostErrors.SlugTaken(slug);
            post.ChangeSlug(slug, now);
        }

        var content = request.Input.ToContent();
        if (post.IsLive)
        {
            // A live post must stay buildable: an edit that would break the site's build is refused, unsaved.
            var check = await BlogPostChecking.CheckAsync(_db, _catalogue, BlogCheckInput.From(post.Slug, content), post.Id, ct);
            if (check.Blockers.Count > 0)
                return Error.Validation("BLOG_POST_NOT_READY", "This post is live, so the change cannot be saved until these are fixed: " + string.Join(" ", check.Blockers));
        }
        if (post.Update(content, now) && post.IsLive)
            BlogSiteChanges.RequestRebuild(_db, $"Live post edited: /blog/{post.Slug}", now);
        if (request.ClearReviewNotes)
            post.ClearReviewNotes(now);

        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(post, _settings.SiteUrl);
    }
}

/// <summary>A copy of a post as a new draft (to try another angle), at "{slug}-copy".</summary>
public sealed record DuplicateBlogPostCommand(Guid Id) : IRequest<Result<BlogPostDto>>;

public sealed class DuplicateBlogPostCommandHandler : IRequestHandler<DuplicateBlogPostCommand, Result<BlogPostDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BlogSettings _settings;

    public DuplicateBlogPostCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, BlogSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<BlogPostDto>> Handle(DuplicateBlogPostCommand request, CancellationToken ct)
    {
        var source = await _db.BlogPosts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (source is null)
            return BlogPostErrors.NotFound;

        var stem = source.Slug.Length > BlogPost.SlugMaxLength - 8 ? source.Slug[..(BlogPost.SlugMaxLength - 8)].TrimEnd('-') : source.Slug;
        var slug = $"{stem}-copy";
        for (var n = 2; await _db.BlogPosts.AnyAsync(p => p.Slug == slug, ct); n++)
            slug = $"{stem}-copy-{n}";

        var content = source.Content() with
        {
            Title = source.Title.Length > BlogPost.TitleMaxLength - 8 ? source.Title : $"{source.Title} (copy)",
        };
        var copy = BlogPost.Create(slug, content, BlogPostSource.Manual, _clock.UtcNow);
        _db.BlogPosts.Add(copy);
        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(copy, _settings.SiteUrl);
    }
}

/// <summary>Deletes a post that is not live (a live one is unpublished or archived first).</summary>
public sealed record DeleteBlogPostCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteBlogPostCommandHandler : IRequestHandler<DeleteBlogPostCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IAuditLogger _audit;

    public DeleteBlogPostCommandHandler(IApplicationDbContext db, IAuditLogger audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<Result> Handle(DeleteBlogPostCommand request, CancellationToken ct)
    {
        var post = await _db.BlogPosts.FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (post is null)
            return BlogPostErrors.NotFound;
        if (!post.CanDelete)
            return Error.Conflict("BLOG_POST_LIVE", "This post is on the site. Unpublish or archive it first.");

        _db.BlogPosts.Remove(post);
        _audit.Record(AdminAuditAction.DeleteBlogPost, null, $"Deleted the blog post /blog/{post.Slug} (\"{post.Title}\").");
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>Runs the checks on a post against the live site's catalogue and the other live posts.</summary>
public static class BlogPostChecking
{
    public static Task<BlogPostCheckDto> CheckAsync(IApplicationDbContext db, IBlogSiteCatalogue catalogue, BlogPost post, CancellationToken ct)
        => CheckAsync(db, catalogue, BlogCheckInput.From(post), post.Id, ct);

    public static async Task<BlogPostCheckDto> CheckAsync(
        IApplicationDbContext db, IBlogSiteCatalogue catalogue, BlogCheckInput input, Guid postId, CancellationToken ct)
    {
        var cat = await catalogue.GetAsync(ct);
        var others = await Drafting.LivePosts.ReadAsync(db, ct, except: postId);
        var result = BlogChecks.Check(input, new BlogCheckContext(cat.IsSuccess ? cat.Value : null, others, []));
        return new BlogPostCheckDto(result.Blockers, result.Advice, cat.IsSuccess);
    }
}
