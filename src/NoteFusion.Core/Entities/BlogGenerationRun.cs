using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>One draft in a batch: what it was about and how it came out.</summary>
public sealed record BlogGenerationItem(
    string Slug,
    string Keyword,
    Guid? TopicId,
    Guid? PostId,
    string? Title,
    bool PassedChecks,
    IReadOnlyList<string> Problems,
    string? Error,
    IReadOnlyList<BlogTokenUsage> Usage);

/// <summary>
/// A batch of drafts asked of the Gemini API, by the founder ("Generate") or by the twice-weekly schedule.
/// The request returns at once with this row; the blog worker writes the drafts one after another and
/// records each here, so the console can show progress and what every draft cost.
/// </summary>
public class BlogGenerationRun : BaseEntity
{
    public const int MaxCount = 10;
    public const int TopicTextMaxLength = 300;
    public const int ErrorMaxLength = 1000;

    private BlogGenerationRun() { } // EF Core

    public BlogGenerationTrigger Trigger { get; private set; }
    public BlogGenerationStatus Status { get; private set; }

    /// <summary>How many drafts were asked for.</summary>
    public int Count { get; private set; }

    /// <summary>A queue topic to draft (Count is then 1), or null for the next ones in the queue.</summary>
    public Guid? TopicId { get; private set; }

    /// <summary>A topic in the founder's own words instead of one from the queue (Count is then 1).</summary>
    public string? TopicText { get; private set; }

    /// <summary>The admin who asked; null for the schedule.</summary>
    public Guid? RequestedByUserId { get; private set; }

    public string? Model { get; private set; }

    public List<BlogGenerationItem> Items { get; private set; } = [];

    /// <summary>Why the run stopped short, when it did (no topics left, the API refusing…).</summary>
    public string? Error { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? StartedAtUtc { get; private set; }
    public DateTime? FinishedAtUtc { get; private set; }

    public int TotalTokens => Items.Sum(i => i.Usage.Sum(u => u.Total));

    public bool IsFinished => Status is BlogGenerationStatus.Succeeded or BlogGenerationStatus.Partial or BlogGenerationStatus.Failed;

    public static BlogGenerationRun Queue(
        BlogGenerationTrigger trigger, int count, Guid? topicId, string? topicText, Guid? requestedBy, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            Trigger = trigger,
            Status = BlogGenerationStatus.Queued,
            Count = Guard.InRange(count, 1, MaxCount),
            TopicId = topicId,
            TopicText = string.IsNullOrWhiteSpace(topicText) ? null : topicText.Trim(),
            RequestedByUserId = requestedBy,
            CreatedAtUtc = utcNow,
        };

    public void Start(string model, DateTime utcNow)
    {
        Status = BlogGenerationStatus.Running;
        Model = model;
        StartedAtUtc = utcNow;
    }

    public void Add(BlogGenerationItem item) => Items = [.. Items, item];

    /// <summary>Ends the run; its status follows from the drafts it saved.</summary>
    public void Finish(DateTime utcNow, string? error = null)
    {
        var saved = Items.Count(i => i.PostId is not null);
        var clean = Items.Count(i => i.PostId is not null && i.PassedChecks);
        Status = saved == 0
            ? BlogGenerationStatus.Failed
            : clean == Count && error is null ? BlogGenerationStatus.Succeeded : BlogGenerationStatus.Partial;
        Error = error is null ? null : error.Length > ErrorMaxLength ? error[..ErrorMaxLength] : error;
        FinishedAtUtc = utcNow;
    }
}
