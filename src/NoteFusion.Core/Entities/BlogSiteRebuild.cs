using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A request to rebuild and redeploy notefusion.studio because what the blog shows changed (a post went live,
/// came off, or a live post was edited). Written in the same save as the change, so a restart cannot lose
/// it; the blog worker coalesces every pending request into one GitHub <c>workflow_dispatch</c> of the deploy
/// workflow, at most one every couple of minutes, and stamps them all with that dispatch.
/// </summary>
public class BlogSiteRebuild : BaseEntity
{
    public const int ReasonMaxLength = 300;
    public const int ErrorMaxLength = 500;

    private BlogSiteRebuild() { } // EF Core

    public string Reason { get; private set; } = string.Empty;
    public DateTime RequestedAtUtc { get; private set; }

    /// <summary>When GitHub accepted the dispatch that covered this request; null while pending.</summary>
    public DateTime? DispatchedAtUtc { get; private set; }

    /// <summary>The last dispatch attempt, successful or not (spaces out retries).</summary>
    public DateTime? LastAttemptAtUtc { get; private set; }

    public int Attempts { get; private set; }

    /// <summary>Why the last attempt failed.</summary>
    public string? Error { get; private set; }

    public static BlogSiteRebuild Request(string reason, DateTime utcNow) => new()
    {
        Id = Guid.NewGuid(),
        Reason = Trim(Guard.NotNullOrWhiteSpace(reason), ReasonMaxLength),
        RequestedAtUtc = utcNow,
    };

    public void MarkDispatched(DateTime utcNow)
    {
        DispatchedAtUtc = utcNow;
        LastAttemptAtUtc = utcNow;
        Attempts++;
        Error = null;
    }

    public void MarkFailed(string error, DateTime utcNow)
    {
        LastAttemptAtUtc = utcNow;
        Attempts++;
        Error = Trim(string.IsNullOrWhiteSpace(error) ? "Unknown error" : error, ErrorMaxLength);
    }

    private static string Trim(string s, int max) => s.Length > max ? s[..max] : s;
}
