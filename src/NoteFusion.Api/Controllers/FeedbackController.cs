using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Feedback;

namespace NoteFusion.Api.Controllers;

/// <summary>Feedback, ratings and "where did you hear about us?", from the app and the web app.</summary>
[Authorize]
[Route("api/feedback")]
public sealed class FeedbackController : ApiControllerBase
{
    private readonly ISender _sender;

    public FeedbackController(ISender sender) => _sender = sender;

    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] SubmitFeedbackCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>Which prompts this client should show this account now. <paramref name="client"/> is "app" or "web".</summary>
    [HttpGet("prompts")]
    public async Task<IActionResult> Prompts([FromQuery] string? client, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetFeedbackPromptsQuery(client), ct));
}

/// <summary>The console's view of what users told us. Admin only.</summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/feedback")]
public sealed class AdminFeedbackController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminFeedbackController(ISender sender) => _sender = sender;

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetFeedbackSummaryQuery(), ct));

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, [FromQuery] string? kind = null, [FromQuery] Guid? userId = null,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetFeedbackListQuery(page, pageSize, kind, userId), ct));
}
