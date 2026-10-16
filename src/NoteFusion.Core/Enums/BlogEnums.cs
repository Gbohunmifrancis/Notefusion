namespace NoteFusion.Core.Enums;

/// <summary>
/// Where a blog post stands. Only <see cref="Published"/> posts are on notefusion.studio; the static build reads
/// them from <c>GET /api/blog/published</c>. <see cref="Scheduled"/> becomes Published when its time comes
/// (the blog worker), <see cref="Archived"/> is off the site but kept.
/// </summary>
public enum BlogPostStatus
{
    Draft = 0,
    Scheduled = 1,
    Published = 2,
    Archived = 3
}

/// <summary>Who wrote a post's first version.</summary>
public enum BlogPostSource
{
    /// <summary>Written in the admin console.</summary>
    Manual = 0,

    /// <summary>Drafted by the Gemini API from a topic, for the founder to review.</summary>
    Gemini = 1,

    /// <summary>One of the posts that were Markdown files in the repository before the blog moved to the database.</summary>
    Imported = 2
}

/// <summary>A topic in the drafting queue.</summary>
public enum BlogTopicStatus
{
    /// <summary>Waiting: the next "Generate" takes the first of these.</summary>
    Unused = 0,

    /// <summary>A draft was made from it (or a post with its slug already exists).</summary>
    Used = 1,

    /// <summary>Left in the list but never drafted.</summary>
    Skipped = 2
}

/// <summary>What asked for a batch of drafts.</summary>
public enum BlogGenerationTrigger
{
    Admin = 0,
    Schedule = 1
}

/// <summary>A batch of drafts: waiting for the worker, being written, or done.</summary>
public enum BlogGenerationStatus
{
    Queued = 0,
    Running = 1,

    /// <summary>Every draft asked for was saved and passed the checks.</summary>
    Succeeded = 2,

    /// <summary>Some drafts were saved; others failed or were saved with problems left to fix.</summary>
    Partial = 3,

    /// <summary>No draft was saved.</summary>
    Failed = 4
}
