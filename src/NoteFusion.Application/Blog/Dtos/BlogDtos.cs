using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Blog.Dtos;

/// <summary>One question and answer, on the wire.</summary>
public sealed record BlogFaqDto(string Question, string Answer);

/// <summary>A cover image: the social card and the picture over the post.</summary>
public sealed record BlogCoverDto(string Src, string Alt, int Width, int Height);

/// <summary>A row of the console's posts table.</summary>
public sealed record BlogPostRowDto(
    Guid Id,
    string Slug,
    string Title,
    string Status,
    string Source,
    IReadOnlyList<string> Tags,
    DateTime? PublishAtUtc,
    DateTime? PublishedAtUtc,
    DateTime UpdatedAtUtc,
    DateTime CreatedAtUtc,
    int Words,
    int ReviewNotes,
    string? GenerationModel,
    int TotalTokens,
    string Path);

/// <summary>A post in the editor: everything that can be changed, its state, and how it was generated.</summary>
public sealed record BlogPostDto(
    Guid Id,
    string Slug,
    bool SlugLocked,
    string Title,
    string? Dek,
    string Description,
    string Body,
    IReadOnlyList<string> Tags,
    string? Keyword,
    BlogCoverDto? Cover,
    IReadOnlyList<BlogFaqDto> Faq,
    string? SeoTitle,
    string? SeoDescription,
    string Author,
    string Status,
    string Source,
    DateTime? PublishAtUtc,
    DateTime? PublishedAtUtc,
    DateTime? RevisedAtUtc,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    Guid? TopicId,
    string? GenerationModel,
    IReadOnlyList<BlogTokenUsage> GenerationUsage,
    IReadOnlyList<string> ReviewNotes,
    int Words,
    int Version,
    string Path,
    string Url);

/// <summary>The checks' verdict: blockers stop publishing, advice does not.</summary>
public sealed record BlogPostCheckDto(IReadOnlyList<string> Blockers, IReadOnlyList<string> Advice, bool CheckedAgainstSite);

/// <summary>A topic in the drafting queue.</summary>
public sealed record BlogTopicDto(
    Guid Id,
    string Slug,
    string Keyword,
    string Intent,
    string Angle,
    IReadOnlyList<string> Links,
    string Status,
    int Position,
    Guid? PostId,
    DateTime UpdatedAtUtc);

/// <summary>A batch of drafts and how far it has got.</summary>
public sealed record BlogGenerationRunDto(
    Guid Id,
    string Trigger,
    string Status,
    int Count,
    string? TopicText,
    Guid? TopicId,
    string? Model,
    IReadOnlyList<BlogGenerationItem> Items,
    int TotalTokens,
    string? Error,
    DateTime CreatedAtUtc,
    DateTime? StartedAtUtc,
    DateTime? FinishedAtUtc);

/// <summary>The latest rebuild request and the deploy workflow's newest run, for the console.</summary>
public sealed record BlogSiteStatusDto(
    bool RebuildsEnabled,
    string? RebuildTarget,
    bool DraftingEnabled,
    string Model,
    string SiteUrl,
    int PendingRebuilds,
    DateTime? LastRequestedAtUtc,
    DateTime? LastDispatchedAtUtc,
    string? LastError,
    BlogDeployRunDto? LatestDeploy,
    string? AutoDraftSchedule);

public sealed record BlogDeployRunDto(string Status, string? Conclusion, string Url, DateTime CreatedAtUtc, string Event);

/// <summary>A live post as the website's build reads it (<c>tools/blog/lib/api-posts.mjs</c>).</summary>
public sealed record PublishedBlogPostDto(
    string Slug,
    string Title,
    string? Dek,
    string Description,
    string? SeoTitle,
    string? SeoDescription,
    string Date,
    string? Updated,
    string Author,
    IReadOnlyList<string> Tags,
    string? Keyword,
    BlogCoverDto? Cover,
    IReadOnlyList<BlogFaqDto> Faq,
    string Body);

/// <summary>Every live post, newest first, with a stamp the build and caches can compare.</summary>
public sealed record PublishedBlogDto(string Version, IReadOnlyList<PublishedBlogPostDto> Posts);

internal static class BlogMapping
{
    /// <summary>Lagos keeps no daylight saving: a post's date is its West Africa Time day.</summary>
    public static readonly TimeSpan SiteOffset = TimeSpan.FromHours(1);

    public static string SiteDate(DateTime utc) => (utc + SiteOffset).ToString("yyyy-MM-dd");

    public static string PathOf(string slug) => $"/blog/{slug}";

    public static BlogCoverDto? Cover(BlogPost p)
        => p.CoverUrl is { } url && p.CoverWidth is { } w && p.CoverHeight is { } h
            ? new BlogCoverDto(url, p.CoverAlt ?? string.Empty, w, h)
            : null;

    public static BlogPostDto ToDto(BlogPost p, string siteUrl) => new(
        p.Id, p.Slug, p.SlugLocked, p.Title, p.Dek, p.Description, p.Body, p.Tags, p.Keyword, Cover(p),
        p.Faq.Select(f => new BlogFaqDto(f.Question, f.Answer)).ToList(), p.SeoTitle, p.SeoDescription, p.Author,
        p.Status.ToString(), p.Source.ToString(), p.PublishAtUtc, p.PublishedAtUtc, p.RevisedAtUtc, p.CreatedAtUtc,
        p.UpdatedAtUtc, p.TopicId, p.GenerationModel, p.GenerationUsage, p.ReviewNotes,
        BlogChecks.CountWords(BlogChecks.StripFences(p.Body)), p.Version, PathOf(p.Slug),
        siteUrl.TrimEnd('/') + PathOf(p.Slug));

    public static BlogTopicDto ToDto(BlogTopic t) => new(
        t.Id, t.Slug, t.Keyword, t.Intent, t.Angle, t.Links, t.Status.ToString(), t.Position, t.PostId, t.UpdatedAtUtc);

    public static BlogGenerationRunDto ToDto(BlogGenerationRun r) => new(
        r.Id, r.Trigger.ToString(), r.Status.ToString(), r.Count, r.TopicText, r.TopicId, r.Model, r.Items, r.TotalTokens,
        r.Error, r.CreatedAtUtc, r.StartedAtUtc, r.FinishedAtUtc);

    public static PublishedBlogPostDto ToPublished(BlogPost p)
    {
        var date = SiteDate(p.PublishedAtUtc ?? p.CreatedAtUtc);
        var updated = p.RevisedAtUtc is { } r ? SiteDate(r) : null;
        return new PublishedBlogPostDto(
            p.Slug, p.Title, p.Dek, p.Description, p.SeoTitle, p.SeoDescription, date,
            updated is not null && string.CompareOrdinal(updated, date) > 0 ? updated : null,
            p.Author, p.Tags, p.Keyword, Cover(p), p.Faq.Select(f => new BlogFaqDto(f.Question, f.Answer)).ToList(), p.Body);
    }
}
