using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A topic in the drafting queue (what used to be content/blog/topics.yml). "Generate" takes the first
/// <see cref="BlogTopicStatus.Unused"/> topics by <see cref="Position"/> whose slug has no post yet.
/// </summary>
public class BlogTopic : BaseEntity
{
    public const int KeywordMaxLength = 200;
    public const int IntentMaxLength = 500;
    public const int AngleMaxLength = 1000;
    public const int MaxLinks = 10;

    private BlogTopic() { } // EF Core

    /// <summary>The post's URL when drafted: /blog/{slug}. Unique.</summary>
    public string Slug { get; private set; } = string.Empty;

    /// <summary>The search phrase the post is written to answer.</summary>
    public string Keyword { get; private set; } = string.Empty;

    /// <summary>What the searcher wants.</summary>
    public string Intent { get; private set; } = string.Empty;

    /// <summary>What makes our post worth reading over the others.</summary>
    public string Angle { get; private set; } = string.Empty;

    /// <summary>Site paths the post must link to (those that exist when it is drafted; /app always).</summary>
    public List<string> Links { get; private set; } = [];

    public BlogTopicStatus Status { get; private set; }

    /// <summary>Queue order, lowest first.</summary>
    public int Position { get; private set; }

    /// <summary>The draft made from it.</summary>
    public Guid? PostId { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public static BlogTopic Create(
        string slug, string keyword, string intent, string angle, IEnumerable<string> links, int position, DateTime utcNow)
    {
        var topic = new BlogTopic
        {
            Id = Guid.NewGuid(),
            Status = BlogTopicStatus.Unused,
            CreatedAtUtc = utcNow,
        };
        topic.Update(slug, keyword, intent, angle, links, position, utcNow);
        return topic;
    }

    public void Update(string slug, string keyword, string intent, string angle, IEnumerable<string> links, int position, DateTime utcNow)
    {
        Slug = Guard.NotNullOrWhiteSpace(slug).Trim();
        Keyword = Guard.NotNullOrWhiteSpace(keyword).Trim();
        Intent = (intent ?? string.Empty).Trim();
        Angle = (angle ?? string.Empty).Trim();
        Links = links.Select(l => l.Trim()).Where(l => l.Length > 0).Distinct().ToList();
        Position = position;
        UpdatedAtUtc = utcNow;
    }

    public void SetStatus(BlogTopicStatus status, DateTime utcNow)
    {
        Status = status;
        if (status == BlogTopicStatus.Unused)
            PostId = null;
        UpdatedAtUtc = utcNow;
    }

    /// <summary>A draft was saved from this topic.</summary>
    public void MarkUsed(Guid? postId, DateTime utcNow)
    {
        Status = BlogTopicStatus.Used;
        PostId = postId;
        UpdatedAtUtc = utcNow;
    }
}
