using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Infrastructure.Persistence.Seed;

/// <summary>
/// The blog as it was in the repository before it moved to the database: the two launch posts
/// (content/blog/*.md, converted to <c>blog-seed.json</c> with their front matter and Markdown untouched) and
/// the topic queue (content/blog/topics.yml). The <c>AddBlog</c> migration inserts them once — never again,
/// so a post deleted in the console stays deleted. Ids are derived from the slug.
/// </summary>
internal static class BlogSeed
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>A post's date at 06:00 UTC (07:00 in Lagos), so its day on the site is the day it carried.</summary>
    private static readonly TimeSpan PublishTime = TimeSpan.FromHours(6);

    public sealed record SeedFaq(string Question, string Answer);

    public sealed record SeedCover(string Src, string Alt, int Width, int Height);

    public sealed record SeedPost(
        string Slug, string Title, string? Dek, string Description, string Date, string? Updated, string Author,
        List<string> Tags, string? Keyword, List<SeedFaq>? Faq, SeedCover? Cover, string Body,
        bool Draft = false, string? DraftedWith = null);

    public sealed record SeedTopic(string Slug, string Keyword, string Intent, string Angle, List<string> Links, bool Skip, int Position);

    public sealed record SeedFile(List<SeedPost> Posts, List<SeedTopic> Topics);

    public static SeedFile Load()
    {
        using var stream = typeof(BlogSeed).Assembly.GetManifestResourceStream("NoteFusion.BlogSeed.json")
            ?? throw new InvalidOperationException("The blog seed resource is missing from the Infrastructure assembly.");
        return JsonSerializer.Deserialize<SeedFile>(stream, Json) ?? throw new InvalidOperationException("The blog seed is empty.");
    }

    public static Guid IdFor(string kind, string slug)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"notefusion-blog-{kind}:{slug}"));
        return new Guid(hash.AsSpan(0, 16));
    }

    public static DateTime Utc(string date)
        => DateTime.SpecifyKind(DateTime.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture) + PublishTime, DateTimeKind.Utc);

    public static readonly string[] PostColumns =
    [
        "Id", "Slug", "Title", "Dek", "Description", "Body", "tags_json", "Keyword", "CoverUrl", "CoverAlt", "CoverWidth",
        "CoverHeight", "faq_json", "SeoTitle", "SeoDescription", "Author", "Status", "Source", "PublishAtUtc",
        "PublishedAtUtc", "RevisedAtUtc", "CreatedAtUtc", "UpdatedAtUtc", "TopicId", "GenerationModel",
        "generation_usage_json", "review_notes_json", "Version",
    ];

    public static object?[,] PostRows(SeedFile seed)
    {
        var rows = new object?[seed.Posts.Count, PostColumns.Length];
        for (var i = 0; i < seed.Posts.Count; i++)
        {
            var p = seed.Posts[i];
            var dated = Utc(p.Date);
            DateTime? published = p.Draft ? null : dated;
            DateTime? revised = p.Updated is { } u ? Utc(u) : null;
            var faq = (p.Faq ?? []).Select(f => new BlogFaqItem(f.Question, f.Answer)).ToList();
            object?[] row =
            [
                IdFor("post", p.Slug), p.Slug, p.Title, p.Dek, p.Description, p.Body, JsonSerializer.Serialize(p.Tags, Json),
                p.Keyword, p.Cover?.Src, p.Cover?.Alt, p.Cover?.Width, p.Cover?.Height, JsonSerializer.Serialize(faq, Json),
                null, null, p.Author,
                (p.Draft ? BlogPostStatus.Draft : BlogPostStatus.Published).ToString(),
                (p.Draft ? BlogPostSource.Gemini : BlogPostSource.Imported).ToString(), null,
                published, revised, dated, revised ?? dated, null, p.DraftedWith, "[]", "[]", 1,
            ];
            for (var c = 0; c < row.Length; c++)
                rows[i, c] = row[c];
        }
        return rows;
    }

    public static readonly string[] TopicColumns =
        ["Id", "Slug", "Keyword", "Intent", "Angle", "links_json", "Status", "Position", "PostId", "CreatedAtUtc", "UpdatedAtUtc"];

    public static object?[,] TopicRows(SeedFile seed, DateTime createdAtUtc)
    {
        var postSlugs = seed.Posts.Select(p => p.Slug).ToHashSet(StringComparer.Ordinal);
        var rows = new object?[seed.Topics.Count, TopicColumns.Length];
        for (var i = 0; i < seed.Topics.Count; i++)
        {
            var t = seed.Topics[i];
            var status = t.Skip ? BlogTopicStatus.Skipped : postSlugs.Contains(t.Slug) ? BlogTopicStatus.Used : BlogTopicStatus.Unused;
            object?[] row =
            [
                IdFor("topic", t.Slug), t.Slug, t.Keyword, t.Intent, t.Angle, JsonSerializer.Serialize(t.Links, Json),
                status.ToString(), t.Position, postSlugs.Contains(t.Slug) ? IdFor("post", t.Slug) : null, createdAtUtc, createdAtUtc,
            ];
            for (var c = 0; c < row.Length; c++)
                rows[i, c] = row[c];
        }
        return rows;
    }
}
