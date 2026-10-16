using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Commands;

/// <summary>What the console can do to a post's place on the site.</summary>
public enum BlogPostAction
{
    /// <summary>On the site now (after the checks); the site is rebuilt.</summary>
    Publish,

    /// <summary>On the site at <c>PublishAtUtc</c> (after the checks); the blog worker publishes it then.</summary>
    Schedule,

    /// <summary>Back to a draft: off the site, the schedule cancelled, or out of the archive.</summary>
    Unpublish,

    /// <summary>Off the site and out of the way, kept.</summary>
    Archive
}

/// <summary>
/// Publishes, schedules, unpublishes or archives a post. Publishing and scheduling run the checks first and
/// refuse a post with blockers (what would stop the site's build). Whatever changes what the site shows asks
/// for a rebuild. Every action is in the audit trail.
/// </summary>
public sealed record ChangeBlogPostStatusCommand(Guid Id, BlogPostAction Action, DateTime? PublishAtUtc = null) : IRequest<Result<BlogPostDto>>;

public sealed class ChangeBlogPostStatusCommandHandler : IRequestHandler<ChangeBlogPostStatusCommand, Result<BlogPostDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IBlogSiteCatalogue _catalogue;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly BlogSettings _settings;

    public ChangeBlogPostStatusCommandHandler(
        IApplicationDbContext db, IBlogSiteCatalogue catalogue, IAuditLogger audit, IDateTimeProvider clock, BlogSettings settings)
    {
        _db = db;
        _catalogue = catalogue;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<BlogPostDto>> Handle(ChangeBlogPostStatusCommand request, CancellationToken ct)
    {
        var post = await _db.BlogPosts.FirstOrDefaultAsync(p => p.Id == request.Id, ct);
        if (post is null)
            return BlogPostErrors.NotFound;
        var now = _clock.UtcNow;
        var path = $"/blog/{post.Slug}";

        switch (request.Action)
        {
            case BlogPostAction.Publish:
            {
                if (!post.CanPublish)
                    return Error.Conflict("BLOG_POST_ALREADY_LIVE", "This post is already published.");
                if (await NotReadyAsync(post, ct) is { } notReady)
                    return notReady;
                post.Publish(now);
                BlogSiteChanges.RequestRebuild(_db, $"Published {path}", now);
                _audit.Record(AdminAuditAction.PublishBlogPost, null, $"Published the blog post {path} (\"{post.Title}\").");
                break;
            }
            case BlogPostAction.Schedule:
            {
                if (request.PublishAtUtc is not { } at)
                    return Error.Validation("BLOG_SCHEDULE_TIME_REQUIRED", "Choose when the post should go live.");
                var atUtc = at.Kind == DateTimeKind.Local ? at.ToUniversalTime() : DateTime.SpecifyKind(at, DateTimeKind.Utc);
                if (atUtc <= now.AddMinutes(1))
                    return Error.Validation("BLOG_SCHEDULE_IN_PAST", "Choose a time in the future (or publish it now).");
                if (!post.CanSchedule)
                    return Error.Conflict("BLOG_POST_ALREADY_LIVE", "This post is already published; unpublish it first to schedule it.");
                if (await NotReadyAsync(post, ct) is { } notReady)
                    return notReady;
                post.Schedule(atUtc, now);
                _audit.Record(AdminAuditAction.PublishBlogPost, null, $"Scheduled the blog post {path} for {atUtc:yyyy-MM-dd HH:mm} UTC.");
                break;
            }
            case BlogPostAction.Unpublish:
            {
                if (!post.CanUnpublish)
                    return Error.Conflict("BLOG_POST_ALREADY_DRAFT", "This post is already a draft.");
                var was = post.Status;
                if (post.Unpublish(now))
                    BlogSiteChanges.RequestRebuild(_db, $"Unpublished {path}", now);
                _audit.Record(AdminAuditAction.UnpublishBlogPost, null,
                    was == BlogPostStatus.Scheduled ? $"Cancelled the schedule of {path}." : $"Moved {path} back to drafts (was {was}).");
                break;
            }
            case BlogPostAction.Archive:
            {
                if (!post.CanArchive)
                    return Error.Conflict("BLOG_POST_ALREADY_ARCHIVED", "This post is already archived.");
                if (post.Archive(now))
                    BlogSiteChanges.RequestRebuild(_db, $"Archived {path}", now);
                _audit.Record(AdminAuditAction.ArchiveBlogPost, null, $"Archived the blog post {path}.");
                break;
            }
            default:
                return Error.Validation("BLOG_ACTION_UNKNOWN", "Unknown action.");
        }

        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(post, _settings.SiteUrl);
    }

    private async Task<Error?> NotReadyAsync(BlogPost post, CancellationToken ct)
    {
        var check = await BlogPostChecking.CheckAsync(_db, _catalogue, post, ct);
        return check.Blockers.Count == 0
            ? null
            : Error.Validation("BLOG_POST_NOT_READY", "Fix these before publishing: " + string.Join(" ", check.Blockers));
    }
}

/// <summary>Asks for a site rebuild by hand (the console's "Rebuild the site" button).</summary>
public sealed record RequestBlogRebuildCommand : IRequest<Result>;

public sealed class RequestBlogRebuildCommandHandler : IRequestHandler<RequestBlogRebuildCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IGitHubActions _github;
    private readonly IDateTimeProvider _clock;
    private readonly ICurrentUser _user;

    public RequestBlogRebuildCommandHandler(IApplicationDbContext db, IGitHubActions github, IDateTimeProvider clock, ICurrentUser user)
    {
        _db = db;
        _github = github;
        _clock = clock;
        _user = user;
    }

    public async Task<Result> Handle(RequestBlogRebuildCommand request, CancellationToken ct)
    {
        if (!_github.IsConfigured)
            return Error.Failure("BLOG_REBUILDS_OFF", "Site rebuilds are off: set GitHub__Token on the API (see docs/BLOG.md).");
        BlogSiteChanges.RequestRebuild(_db, $"Asked for by {_user.Email ?? "an admin"}", _clock.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
