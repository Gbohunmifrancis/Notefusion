using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Blog.Commands;
using NoteFusion.Application.Blog.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The blog in the admin console: write, edit, check, publish, schedule, unpublish, archive and delete posts;
/// keep the queue of topics; ask Gemini for drafts; see the site's rebuilds. Publishing changes the database
/// and asks GitHub to rebuild the static site, which reads <c>GET /api/blog/published</c>.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/blog")]
public sealed class AdminBlogController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminBlogController(ISender sender) => _sender = sender;

    // ── Posts ──────────────────────────────────────────────────────────────────────────────

    /// <param name="status">Draft, Scheduled, Published or Archived.</param>
    /// <param name="source">Manual, Gemini or Imported.</param>
    /// <param name="q">Searches the title, slug and keyword.</param>
    /// <param name="page">1-based.</param>
    /// <param name="pageSize">1–200, default 50.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet("posts")]
    public async Task<IActionResult> List(
        [FromQuery] string? status, [FromQuery] string? source, [FromQuery] string? q,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new ListBlogPostsQuery(status, source, q, page, pageSize), ct));

    [HttpGet("posts/{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetBlogPostQuery(id), ct));

    [HttpPost("posts")]
    public async Task<IActionResult> Create([FromBody] BlogPostInput input, CancellationToken ct)
        => HandleResult(await _sender.Send(new CreateBlogPostCommand(input), ct));

    /// <summary>Saves the editor; <c>version</c> is the one it opened (a newer save is a 409).</summary>
    [HttpPut("posts/{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateBlogPostRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateBlogPostCommand(id, body.Version, body.Post, body.ClearReviewNotes), ct));

    [HttpDelete("posts/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteBlogPostCommand(id), ct));

    [HttpPost("posts/{id:guid}/duplicate")]
    public async Task<IActionResult> Duplicate(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new DuplicateBlogPostCommand(id), ct));

    /// <summary>The checks on the editor's fields as they are now (saved or not): blockers and advice.</summary>
    [HttpPost("posts/check")]
    public async Task<IActionResult> Check([FromBody] CheckBlogPostRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new CheckBlogPostQuery(body.Id, body.Post), ct));

    [HttpPost("posts/{id:guid}/publish")]
    public async Task<IActionResult> Publish(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new ChangeBlogPostStatusCommand(id, BlogPostAction.Publish), ct));

    /// <summary><c>{ "publishAtUtc": "2026-10-20T07:00:00Z" }</c>.</summary>
    [HttpPost("posts/{id:guid}/schedule")]
    public async Task<IActionResult> Schedule(Guid id, [FromBody] ScheduleBlogPostRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new ChangeBlogPostStatusCommand(id, BlogPostAction.Schedule, body.PublishAtUtc), ct));

    [HttpPost("posts/{id:guid}/unpublish")]
    public async Task<IActionResult> Unpublish(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new ChangeBlogPostStatusCommand(id, BlogPostAction.Unpublish), ct));

    [HttpPost("posts/{id:guid}/archive")]
    public async Task<IActionResult> Archive(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new ChangeBlogPostStatusCommand(id, BlogPostAction.Archive), ct));

    // ── Topics ─────────────────────────────────────────────────────────────────────────────

    [HttpGet("topics")]
    public async Task<IActionResult> Topics(CancellationToken ct)
        => HandleResult(await _sender.Send(new ListBlogTopicsQuery(), ct));

    [HttpPost("topics")]
    public async Task<IActionResult> CreateTopic([FromBody] BlogTopicInput input, CancellationToken ct)
        => HandleResult(await _sender.Send(new CreateBlogTopicCommand(input), ct));

    [HttpPut("topics/{id:guid}")]
    public async Task<IActionResult> UpdateTopic(Guid id, [FromBody] BlogTopicInput input, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateBlogTopicCommand(id, input), ct));

    [HttpDelete("topics/{id:guid}")]
    public async Task<IActionResult> DeleteTopic(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteBlogTopicCommand(id), ct));

    // ── Drafting ───────────────────────────────────────────────────────────────────────────

    /// <summary><c>{ "count": 3 }</c>, <c>{ "count": 1, "topicId": "…" }</c> or <c>{ "count": 1, "topic": "…" }</c>: queued, returned at once.</summary>
    [HttpPost("generate")]
    public async Task<IActionResult> Generate([FromBody] GenerateBlogDraftsRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new GenerateBlogDraftsCommand(body.Count, body.TopicId, body.Topic), ct));

    [HttpGet("generations")]
    public async Task<IActionResult> Generations([FromQuery] int take = 20, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new ListBlogGenerationRunsQuery(take), ct));

    [HttpGet("generations/{id:guid}")]
    public async Task<IActionResult> Generation(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetBlogGenerationRunQuery(id), ct));

    // ── The site ───────────────────────────────────────────────────────────────────────────

    [HttpGet("site")]
    public async Task<IActionResult> Site(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetBlogSiteStatusQuery(), ct));

    /// <summary>Asks for a rebuild by hand (it goes out with the next dispatch, within a couple of minutes).</summary>
    [HttpPost("site/rebuild")]
    public async Task<IActionResult> Rebuild(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new RequestBlogRebuildCommand(), ct));
}

public sealed record UpdateBlogPostRequest(int Version, BlogPostInput Post, bool ClearReviewNotes = false);

public sealed record CheckBlogPostRequest(Guid? Id, BlogPostInput Post);

public sealed record ScheduleBlogPostRequest(DateTime? PublishAtUtc);

public sealed record GenerateBlogDraftsRequest(int Count = 1, Guid? TopicId = null, string? Topic = null);
