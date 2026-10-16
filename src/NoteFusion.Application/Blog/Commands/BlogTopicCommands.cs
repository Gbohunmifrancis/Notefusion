using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Blog.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Blog.Commands;

/// <summary>A topic as the console sends it. <c>Position</c> null puts a new topic at the end of the queue.</summary>
public sealed record BlogTopicInput(
    string Slug,
    string Keyword,
    string? Intent,
    string? Angle,
    IReadOnlyList<string>? Links,
    int? Position,
    string? Status)
{
    public Error? Problem()
    {
        var problems = new List<string>();
        var slug = (Slug ?? string.Empty).Trim();
        if (!BlogPost.IsSlug(slug) || slug.Length > BlogPost.SlugMaxLength)
            problems.Add("The slug must be lowercase words joined by hyphens (it becomes /blog/<slug>).");
        if (string.IsNullOrWhiteSpace(Keyword) || Keyword.Trim().Length > BlogTopic.KeywordMaxLength)
            problems.Add($"Give the search phrase the post answers (at most {BlogTopic.KeywordMaxLength} characters).");
        if ((Intent?.Trim().Length ?? 0) > BlogTopic.IntentMaxLength)
            problems.Add($"The intent is at most {BlogTopic.IntentMaxLength} characters.");
        if ((Angle?.Trim().Length ?? 0) > BlogTopic.AngleMaxLength)
            problems.Add($"The angle is at most {BlogTopic.AngleMaxLength} characters.");
        var links = Links ?? [];
        if (links.Count > BlogTopic.MaxLinks || links.Any(l => !l.Trim().StartsWith('/') || l.Trim().StartsWith("//") || l.Trim().Length > 200))
            problems.Add($"Links are up to {BlogTopic.MaxLinks} paths on the site, each starting with / (e.g. /hymns/amazing-grace).");
        if (Status is not null && !Enum.TryParse<BlogTopicStatus>(Status, true, out _))
            problems.Add("The status is Unused, Used or Skipped.");
        return problems.Count == 0 ? null : Error.Validation("BLOG_TOPIC_INVALID", string.Join(" ", problems));
    }
}

public sealed record CreateBlogTopicCommand(BlogTopicInput Input) : IRequest<Result<BlogTopicDto>>;

public sealed class CreateBlogTopicCommandHandler : IRequestHandler<CreateBlogTopicCommand, Result<BlogTopicDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public CreateBlogTopicCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<BlogTopicDto>> Handle(CreateBlogTopicCommand request, CancellationToken ct)
    {
        var input = request.Input;
        if (input.Problem() is { } problem)
            return problem;
        var slug = input.Slug.Trim();
        if (await _db.BlogTopics.AnyAsync(t => t.Slug == slug, ct))
            return Error.Conflict("BLOG_TOPIC_EXISTS", $"The queue already has a topic for /blog/{slug}.");

        var position = input.Position ?? ((await _db.BlogTopics.MaxAsync(t => (int?)t.Position, ct) ?? 0) + 10);
        var topic = BlogTopic.Create(slug, input.Keyword, input.Intent ?? string.Empty, input.Angle ?? string.Empty, input.Links ?? [], position, _clock.UtcNow);
        if (input.Status is { } status)
            topic.SetStatus(Enum.Parse<BlogTopicStatus>(status, true), _clock.UtcNow);
        _db.BlogTopics.Add(topic);
        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(topic);
    }
}

public sealed record UpdateBlogTopicCommand(Guid Id, BlogTopicInput Input) : IRequest<Result<BlogTopicDto>>;

public sealed class UpdateBlogTopicCommandHandler : IRequestHandler<UpdateBlogTopicCommand, Result<BlogTopicDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public UpdateBlogTopicCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<BlogTopicDto>> Handle(UpdateBlogTopicCommand request, CancellationToken ct)
    {
        var input = request.Input;
        if (input.Problem() is { } problem)
            return problem;
        var topic = await _db.BlogTopics.FirstOrDefaultAsync(t => t.Id == request.Id, ct);
        if (topic is null)
            return Error.NotFound("BLOG_TOPIC_NOT_FOUND", "There is no such topic.");
        var slug = input.Slug.Trim();
        if (slug != topic.Slug && await _db.BlogTopics.AnyAsync(t => t.Slug == slug && t.Id != topic.Id, ct))
            return Error.Conflict("BLOG_TOPIC_EXISTS", $"The queue already has a topic for /blog/{slug}.");

        topic.Update(slug, input.Keyword, input.Intent ?? string.Empty, input.Angle ?? string.Empty, input.Links ?? [], input.Position ?? topic.Position, _clock.UtcNow);
        if (input.Status is { } status)
        {
            var parsed = Enum.Parse<BlogTopicStatus>(status, true);
            if (parsed != topic.Status)
                topic.SetStatus(parsed, _clock.UtcNow);
        }
        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(topic);
    }
}

public sealed record DeleteBlogTopicCommand(Guid Id) : IRequest<Result>;

public sealed class DeleteBlogTopicCommandHandler : IRequestHandler<DeleteBlogTopicCommand, Result>
{
    private readonly IApplicationDbContext _db;

    public DeleteBlogTopicCommandHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result> Handle(DeleteBlogTopicCommand request, CancellationToken ct)
    {
        var topic = await _db.BlogTopics.FirstOrDefaultAsync(t => t.Id == request.Id, ct);
        if (topic is null)
            return Error.NotFound("BLOG_TOPIC_NOT_FOUND", "There is no such topic.");
        _db.BlogTopics.Remove(topic);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>
/// Asks for drafts: <c>Count</c> (1–10) from the front of the queue, or one on a queue topic (<c>TopicId</c>) or on
/// a topic in the founder's own words (<c>Topic</c>). Returns at once with the queued batch; the blog draft worker
/// writes the drafts and the console polls the batch for progress.
/// </summary>
public sealed record GenerateBlogDraftsCommand(int Count, Guid? TopicId, string? Topic) : IRequest<Result<BlogGenerationRunDto>>;

public sealed class GenerateBlogDraftsCommandHandler : IRequestHandler<GenerateBlogDraftsCommand, Result<BlogGenerationRunDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly Drafting.IGeminiClient _gemini;
    private readonly IAuditLogger _audit;
    private readonly ICurrentUser _user;
    private readonly IDateTimeProvider _clock;

    public GenerateBlogDraftsCommandHandler(
        IApplicationDbContext db, Drafting.IGeminiClient gemini, IAuditLogger audit, ICurrentUser user, IDateTimeProvider clock)
    {
        _db = db;
        _gemini = gemini;
        _audit = audit;
        _user = user;
        _clock = clock;
    }

    public async Task<Result<BlogGenerationRunDto>> Handle(GenerateBlogDraftsCommand request, CancellationToken ct)
    {
        if (!_gemini.IsConfigured)
            return Drafting.GeminiErrors.NotConfigured;
        if (request.Count is < 1 or > BlogGenerationRun.MaxCount)
            return Error.Validation("BLOG_GENERATE_COUNT", $"Ask for 1 to {BlogGenerationRun.MaxCount} drafts.");
        var text = string.IsNullOrWhiteSpace(request.Topic) ? null : request.Topic.Trim();
        if (text is not null && text.Length > BlogGenerationRun.TopicTextMaxLength)
            return Error.Validation("BLOG_GENERATE_TOPIC", $"Keep the topic to {BlogGenerationRun.TopicTextMaxLength} characters.");
        if ((text is not null || request.TopicId is not null) && request.Count != 1)
            return Error.Validation("BLOG_GENERATE_COUNT", "A chosen topic makes one draft; leave the topic empty to draft several from the queue.");
        if (text is not null && request.TopicId is not null)
            return Error.Validation("BLOG_GENERATE_TOPIC", "Choose a topic from the queue or write one, not both.");
        if (request.TopicId is { } id && !await _db.BlogTopics.AnyAsync(t => t.Id == id, ct))
            return Error.NotFound("BLOG_TOPIC_NOT_FOUND", "There is no such topic.");

        var run = BlogGenerationRun.Queue(BlogGenerationTrigger.Admin, request.Count, request.TopicId, text, _user.UserId, _clock.UtcNow);
        _db.BlogGenerationRuns.Add(run);
        _audit.Record(AdminAuditAction.GenerateBlogDrafts, null,
            text is not null ? $"Asked Gemini for a blog draft on \"{text}\"."
            : request.TopicId is not null ? "Asked Gemini for a blog draft on a queue topic."
            : $"Asked Gemini for {request.Count} blog draft(s) from the topic queue.");
        await _db.SaveChangesAsync(ct);
        return BlogMapping.ToDto(run);
    }
}
