using System.Text.RegularExpressions;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>One question and answer under a post (rendered at its end and as FAQPage JSON-LD).</summary>
public sealed record BlogFaqItem(string Question, string Answer);

/// <summary>The tokens one Gemini call used, as its <c>usageMetadata</c> reported them.</summary>
public sealed record BlogTokenUsage(string Call, int Prompt, int Output, int Thinking, int Cached, int Total);

/// <summary>Everything an editor can change on a post, in one value (create, update and duplicate share it).</summary>
public sealed record BlogPostContent(
    string Title,
    string? Dek,
    string Description,
    string Body,
    IReadOnlyList<string> Tags,
    string? Keyword,
    string? CoverUrl,
    string? CoverAlt,
    int? CoverWidth,
    int? CoverHeight,
    IReadOnlyList<BlogFaqItem> Faq,
    string? SeoTitle,
    string? SeoDescription,
    string Author);

/// <summary>
/// A post on the blog at notefusion.studio/blog/{slug}. The database is the one source of posts: the admin
/// console writes and publishes them, and the website's static build reads the published ones from
/// <c>GET /api/blog/published</c> at deploy time. Field limits mirror what the build accepts
/// (<c>tools/blog/lib/content.mjs</c>), so a post the API publishes is a post the build can render.
/// </summary>
public partial class BlogPost : BaseEntity
{
    public const int SlugMaxLength = 100;
    public const int TitleMaxLength = 120;
    public const int DekMaxLength = 240;
    public const int DescriptionMaxLength = 160;
    public const int SeoTitleMaxLength = 60;
    public const int SeoDescriptionMaxLength = 160;
    public const int KeywordMaxLength = 200;
    public const int AuthorMaxLength = 40;
    public const int CoverUrlMaxLength = 500;
    public const int CoverAltMaxLength = 300;
    public const int ModelMaxLength = 80;
    public const int MaxTags = 8;
    public const int TagMaxLength = 40;
    public const int MaxFaq = 12;
    public const int BodyMaxLength = 100_000;

    /// <summary>The site's only author today (content/authors/francis.md in the repository).</summary>
    public const string DefaultAuthor = "francis";

    private BlogPost() { } // EF Core

    /// <summary>The URL: /blog/{slug}. Fixed once the post has been published.</summary>
    public string Slug { get; private set; } = string.Empty;

    public string Title { get; private set; } = string.Empty;

    /// <summary>The standfirst under the title; the description stands in when empty.</summary>
    public string? Dek { get; private set; }

    /// <summary>The summary in lists, the feed and (unless <see cref="SeoDescription"/> is set) the meta description.</summary>
    public string Description { get; private set; } = string.Empty;

    /// <summary>Markdown, sections from ## down; ```solfa blocks are rendered by the engine at build time.</summary>
    public string Body { get; private set; } = string.Empty;

    public List<string> Tags { get; private set; } = [];

    /// <summary>The search phrase the post answers, for the founder's tracking only.</summary>
    public string? Keyword { get; private set; }

    public string? CoverUrl { get; private set; }
    public string? CoverAlt { get; private set; }
    public int? CoverWidth { get; private set; }
    public int? CoverHeight { get; private set; }

    public List<BlogFaqItem> Faq { get; private set; } = [];

    /// <summary>Replaces "{Title} | NoteFusion" as the page's &lt;title&gt; when set.</summary>
    public string? SeoTitle { get; private set; }

    /// <summary>Replaces <see cref="Description"/> as the meta and social description when set.</summary>
    public string? SeoDescription { get; private set; }

    /// <summary>An author id the site knows (content/authors/{id}.md).</summary>
    public string Author { get; private set; } = DefaultAuthor;

    public BlogPostStatus Status { get; private set; }
    public BlogPostSource Source { get; private set; }

    /// <summary>When a <see cref="BlogPostStatus.Scheduled"/> post goes live.</summary>
    public DateTime? PublishAtUtc { get; private set; }

    /// <summary>When it first went live: the post's date on the site. Kept through unpublishing.</summary>
    public DateTime? PublishedAtUtc { get; private set; }

    /// <summary>The last change to what readers see, made while the post was live: the "Updated" date and the sitemap's lastmod.</summary>
    public DateTime? RevisedAtUtc { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>The queue topic it was drafted from, if any.</summary>
    public Guid? TopicId { get; private set; }

    /// <summary>The Gemini model that drafted it.</summary>
    public string? GenerationModel { get; private set; }

    /// <summary>Each Gemini call that went into the draft, with its tokens.</summary>
    public List<BlogTokenUsage> GenerationUsage { get; private set; } = [];

    /// <summary>What the automatic checks still found wrong with a generated draft, for the founder to fix.</summary>
    public List<string> ReviewNotes { get; private set; } = [];

    /// <summary>Bumped on every change; an editor saving over a newer version gets a conflict instead of erasing it.</summary>
    public int Version { get; private set; }

    public bool IsLive => Status == BlogPostStatus.Published;

    /// <summary>The slug can change until the post has ever been published: after that it is a URL people link to.</summary>
    public bool SlugLocked => PublishedAtUtc is not null;

    public static BlogPost Create(string slug, BlogPostContent content, BlogPostSource source, DateTime utcNow)
    {
        var post = new BlogPost
        {
            Id = Guid.NewGuid(),
            Slug = Guard.NotNullOrWhiteSpace(slug),
            Source = source,
            Status = BlogPostStatus.Draft,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow,
            Version = 1,
        };
        post.Apply(content);
        return post;
    }

    /// <summary>
    /// Replaces the editable fields. A change to a live post's content stamps <see cref="RevisedAtUtc"/>
    /// (and the caller asks for a site rebuild). Returns whether readers would see a difference.
    /// </summary>
    public bool Update(BlogPostContent content, DateTime utcNow)
    {
        var before = Fingerprint();
        Apply(content);
        var changed = Fingerprint() != before;
        if (changed && IsLive)
            RevisedAtUtc = utcNow;
        Touch(utcNow);
        return changed;
    }

    /// <summary>Changes the URL. Only while <see cref="SlugLocked"/> is false; the caller checks it and uniqueness.</summary>
    public void ChangeSlug(string slug, DateTime utcNow)
    {
        if (SlugLocked)
            throw new InvalidOperationException("A post that has been published keeps its slug.");
        Slug = Guard.NotNullOrWhiteSpace(slug);
        Touch(utcNow);
    }

    public bool CanPublish => Status != BlogPostStatus.Published;
    public bool CanSchedule => Status is BlogPostStatus.Draft or BlogPostStatus.Scheduled or BlogPostStatus.Archived;
    public bool CanUnpublish => Status is BlogPostStatus.Published or BlogPostStatus.Scheduled;
    public bool CanArchive => Status != BlogPostStatus.Archived;

    /// <summary>A post that is live has to come off the site first; anything else may be deleted.</summary>
    public bool CanDelete => Status != BlogPostStatus.Published;

    /// <summary>Puts it on the site now. Its date is the first time it went live, so a republished post keeps it.</summary>
    public void Publish(DateTime utcNow)
    {
        if (!CanPublish)
            throw new InvalidOperationException("The post is already published.");
        Status = BlogPostStatus.Published;
        PublishedAtUtc ??= utcNow;
        PublishAtUtc = null;
        Touch(utcNow);
    }

    public void Schedule(DateTime publishAtUtc, DateTime utcNow)
    {
        if (!CanSchedule)
            throw new InvalidOperationException("Only a post that is not live can be scheduled.");
        Status = BlogPostStatus.Scheduled;
        PublishAtUtc = publishAtUtc;
        Touch(utcNow);
    }

    /// <summary>Takes it off the site (or cancels its schedule) and back to a draft. Returns whether it was live.</summary>
    public bool Unpublish(DateTime utcNow)
    {
        if (!CanUnpublish)
            throw new InvalidOperationException("The post is not published or scheduled.");
        var wasLive = IsLive;
        Status = BlogPostStatus.Draft;
        PublishAtUtc = null;
        Touch(utcNow);
        return wasLive;
    }

    /// <summary>Off the site and out of the way, kept. Returns whether it was live.</summary>
    public bool Archive(DateTime utcNow)
    {
        if (!CanArchive)
            throw new InvalidOperationException("The post is already archived.");
        var wasLive = IsLive;
        Status = BlogPostStatus.Archived;
        PublishAtUtc = null;
        Touch(utcNow);
        return wasLive;
    }

    /// <summary>The blog worker's step: a scheduled post whose time has come goes live, dated its scheduled time.</summary>
    public bool PublishIfDue(DateTime utcNow)
    {
        if (Status != BlogPostStatus.Scheduled || PublishAtUtc is not { } at || at > utcNow)
            return false;
        Status = BlogPostStatus.Published;
        PublishedAtUtc ??= at;
        PublishAtUtc = null;
        Touch(utcNow);
        return true;
    }

    /// <summary>Records how a generated draft was made: the topic, the model, every call's tokens and what the checks left.</summary>
    public void RecordGeneration(Guid? topicId, string model, IEnumerable<BlogTokenUsage> usage, IEnumerable<string> reviewNotes)
    {
        TopicId = topicId;
        GenerationModel = Truncate(model, ModelMaxLength);
        GenerationUsage = usage.ToList();
        ReviewNotes = reviewNotes.ToList();
    }

    /// <summary>Clears the generated draft's review notes once the founder has dealt with them.</summary>
    public void ClearReviewNotes(DateTime utcNow)
    {
        ReviewNotes = [];
        Touch(utcNow);
    }

    /// <summary>For a post that was a Markdown file in the repository: its original dates.</summary>
    public static BlogPost Import(string slug, BlogPostContent content, DateTime publishedAtUtc, DateTime? revisedAtUtc)
    {
        var post = Create(slug, content, BlogPostSource.Imported, publishedAtUtc);
        post.Status = BlogPostStatus.Published;
        post.PublishedAtUtc = publishedAtUtc;
        post.RevisedAtUtc = revisedAtUtc;
        return post;
    }

    public BlogPostContent Content() => new(
        Title, Dek, Description, Body, Tags, Keyword, CoverUrl, CoverAlt, CoverWidth, CoverHeight, Faq, SeoTitle,
        SeoDescription, Author);

    /// <summary>"How to Read Solfa!" → "how-to-read-solfa"; at most <see cref="SlugMaxLength"/> characters.</summary>
    public static string Slugify(string text)
    {
        var s = (text ?? string.Empty).Normalize(System.Text.NormalizationForm.FormKD);
        s = new string(s.Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
            != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());
        s = s.ToLowerInvariant().Replace("'", string.Empty).Replace("’", string.Empty);
        s = NonSlug().Replace(s, "-").Trim('-');
        if (s.Length > SlugMaxLength)
            s = s[..SlugMaxLength].TrimEnd('-');
        return s;
    }

    /// <summary>Lowercase words joined by single hyphens: what the site accepts as a slug or a tag.</summary>
    public static bool IsSlug(string? text) => text is not null && SlugPattern().IsMatch(text);

    private void Apply(BlogPostContent c)
    {
        Title = c.Title.Trim();
        Dek = Blank(c.Dek);
        Description = (c.Description ?? string.Empty).Trim();
        Body = c.Body ?? string.Empty;
        Tags = c.Tags.Select(t => t.Trim().ToLowerInvariant()).Where(t => t.Length > 0).Distinct().ToList();
        Keyword = Blank(c.Keyword);
        CoverUrl = Blank(c.CoverUrl);
        CoverAlt = CoverUrl is null ? null : Blank(c.CoverAlt);
        CoverWidth = CoverUrl is null ? null : c.CoverWidth;
        CoverHeight = CoverUrl is null ? null : c.CoverHeight;
        Faq = c.Faq.Select(f => new BlogFaqItem(f.Question.Trim(), f.Answer.Trim())).ToList();
        SeoTitle = Blank(c.SeoTitle);
        SeoDescription = Blank(c.SeoDescription);
        Author = Blank(c.Author) ?? DefaultAuthor;
    }

    /// <summary>What a reader of the live page would see, for telling a real revision from a no-op save.</summary>
    private string Fingerprint() => string.Join("\u0001",
        Title, Dek, Description, Body, string.Join(",", Tags), CoverUrl, CoverAlt, CoverWidth, CoverHeight,
        string.Join("\u0002", Faq.Select(f => f.Question + "\u0003" + f.Answer)), SeoTitle, SeoDescription, Author);

    private void Touch(DateTime utcNow)
    {
        UpdatedAtUtc = utcNow;
        Version++;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string Truncate(string s, int max) => s.Length > max ? s[..max] : s;

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlug();

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex SlugPattern();
}
