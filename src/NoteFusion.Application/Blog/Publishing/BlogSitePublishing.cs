using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Publishing;

/// <summary>The newest run of the website's deploy workflow, as GitHub reports it.</summary>
public sealed record SiteDeployRun(string Status, string? Conclusion, string Url, DateTime CreatedAtUtc, string Event);

/// <summary>
/// GitHub Actions, for the one thing the blog needs from it: run the website's deploy workflow
/// (<c>.github/workflows/deploy-web.yml</c>, which rebuilds the static blog from the API and deploys it).
/// Infrastructure's <c>GitHubActionsClient</c> calls the REST API with <c>GitHub__Token</c>.
/// </summary>
public interface IGitHubActions
{
    /// <summary>False when <c>GitHub__Token</c> or <c>GitHub__Repo</c> is not set: changes wait, unbuilt.</summary>
    bool IsConfigured { get; }

    /// <summary>"owner/repo · deploy-web.yml on main", for the console.</summary>
    string Target { get; }

    /// <summary>workflow_dispatch of the deploy workflow on its branch.</summary>
    Task<Result> DispatchSiteDeployAsync(CancellationToken ct);

    /// <summary>The newest run of the deploy workflow, or null when it has none.</summary>
    Task<Result<SiteDeployRun?>> LatestSiteDeployAsync(CancellationToken ct);
}

/// <summary>Stages a rebuild request in the caller's save (see <see cref="BlogSiteRebuild"/>).</summary>
public static class BlogSiteChanges
{
    public static void RequestRebuild(IApplicationDbContext db, string reason, DateTime utcNow)
        => db.BlogSiteRebuilds.Add(BlogSiteRebuild.Request(reason, utcNow));
}

/// <summary>
/// The site worker's two jobs, every few seconds: put scheduled posts live when their time comes, and turn the
/// pending rebuild requests into one dispatch of the deploy workflow — after the changes have been quiet for
/// <see cref="BlogSettings.RebuildQuietPeriod"/> (or <see cref="BlogSettings.RebuildMaxWait"/> after the first),
/// never sooner than <see cref="BlogSettings.RebuildMinInterval"/> after the last dispatch, and
/// <see cref="BlogSettings.RebuildRetryDelay"/> after a failed one. A burst of edits is one deploy; a request
/// that arrives while a deploy runs gets the next one (the deploy workflow queues it).
/// </summary>
public sealed class BlogSitePublisher
{
    private readonly IApplicationDbContext _db;
    private readonly IGitHubActions _github;
    private readonly BlogSettings _settings;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<BlogSitePublisher> _logger;

    public BlogSitePublisher(IApplicationDbContext db, IGitHubActions github, BlogSettings settings, IDateTimeProvider clock, ILogger<BlogSitePublisher> logger)
    {
        _db = db;
        _github = github;
        _settings = settings;
        _clock = clock;
        _logger = logger;
    }

    /// <summary>Publishes every scheduled post that is due. Returns how many went live.</summary>
    public async Task<int> PublishDueAsync(CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var due = await _db.BlogPosts
            .Where(p => p.Status == BlogPostStatus.Scheduled && p.PublishAtUtc <= now)
            .ToListAsync(ct);
        foreach (var post in due)
        {
            if (post.PublishIfDue(now))
            {
                BlogSiteChanges.RequestRebuild(_db, $"Scheduled post went live: /blog/{post.Slug}", now);
                _logger.LogInformation("Scheduled blog post {Slug} is live.", post.Slug);
            }
        }
        if (due.Count > 0)
            await _db.SaveChangesAsync(ct);
        return due.Count;
    }

    /// <summary>Dispatches one rebuild for every pending request when the timing allows. Returns whether it dispatched.</summary>
    public async Task<bool> DispatchRebuildIfDueAsync(CancellationToken ct)
    {
        if (!_github.IsConfigured)
            return false;
        var pending = await _db.BlogSiteRebuilds.Where(r => r.DispatchedAtUtc == null).ToListAsync(ct);
        if (pending.Count == 0)
            return false;

        var now = _clock.UtcNow;
        var oldest = pending.Min(r => r.RequestedAtUtc);
        var newest = pending.Max(r => r.RequestedAtUtc);
        if (now - newest < _settings.RebuildQuietPeriod && now - oldest < _settings.RebuildMaxWait)
            return false;

        var lastDispatch = await _db.BlogSiteRebuilds.Where(r => r.DispatchedAtUtc != null).MaxAsync(r => r.DispatchedAtUtc, ct);
        if (lastDispatch is { } last && now - last < _settings.RebuildMinInterval)
            return false;
        var lastAttempt = pending.Max(r => r.LastAttemptAtUtc);
        if (lastAttempt is { } tried && now - tried < _settings.RebuildRetryDelay)
            return false;

        var result = await _github.DispatchSiteDeployAsync(ct);
        foreach (var request in pending)
        {
            if (result.IsSuccess)
                request.MarkDispatched(now);
            else
                request.MarkFailed(result.Error.Message, now);
        }
        await _db.SaveChangesAsync(ct);

        if (result.IsSuccess)
            _logger.LogInformation("Asked GitHub to rebuild the website ({Count} change(s): {Reasons}).",
                pending.Count, string.Join("; ", pending.Select(r => r.Reason).Distinct().Take(5)));
        else
            _logger.LogWarning("Could not ask GitHub to rebuild the website: {Error}", result.Error.Message);
        return result.IsSuccess;
    }
}
