using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Api.Realtime;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Support;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Live support, the customer's side: their thread, a message, and the thread's live stream. Open to website visitors
/// (who send <c>X-Support-Key</c>, a random key their browser keeps) and to signed-in people (known by their token).
/// </summary>
[AllowAnonymous]
[Route("api/support")]
[NoActivity]
public sealed class SupportController : ApiControllerBase
{
    public const string KeyHeader = "X-Support-Key";
    private readonly ISender _sender;

    public SupportController(ISender sender) => _sender = sender;

    private string? Key => Request.Headers.TryGetValue(KeyHeader, out var v) ? v.ToString() : null;

    /// <summary>How quickly customers are answered (the median wait in minutes, null until five answers), for the chat's home.</summary>
    [HttpGet("info")]
    public async Task<IActionResult> Info(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSupportInfoQuery(), ct));

    /// <summary>The caller's thread (newest 200 messages); <c>conversationId</c> null when they have not written yet.</summary>
    [HttpGet("thread")]
    public async Task<IActionResult> Thread(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSupportThreadQuery(Key), ct));

    /// <summary>
    /// <c>{ body, source, path?, name?, email? }</c>: a message from the caller; source is "site", "web" or "app".
    /// 422 <c>SUPPORT_TOO_FAST</c> past fifteen in five minutes.
    /// </summary>
    [HttpPost("messages")]
    [EnableRateLimiting(AuthRateLimiting.Support)]
    public async Task<IActionResult> Send(SupportMessageRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SendSupportMessageCommand(
            body.Body, Key, body.Source ?? "site", body.Path, body.Name, body.Email), ct));

    /// <summary>
    /// The thread's live stream while the chat is open: <c>message</c> when either side writes (the client asks for the
    /// thread then), a ping every 20 s, closed after 10 minutes (the client opens another).
    /// </summary>
    [HttpGet("events")]
    public async Task<IActionResult> Events(
        [FromServices] IJobEvents events, [FromServices] ICurrentUser caller, [FromServices] IOptions<JsonOptions> json,
        [FromQuery] bool away, CancellationToken ct)
    {
        var thread = await _sender.Send(new GetSupportThreadQuery(Key), ct);
        if (thread.IsFailure || thread.Value.ConversationId is not { } id)
            return NotFound(new ApiError("SUPPORT_NOT_FOUND", "There is no conversation yet."));
        using var watch = events.Watch(SupportRules.EventKey(id), caller.UserId is { } u ? $"user:{u}" : $"support:{id}", away);
        if (watch is null)
            return StatusCode(StatusCodes.Status429TooManyRequests, new ApiError(
                "JOB_STREAMS_FULL", "Too many live views are open at once. Close one and try again."));
        await JobEventStream.WriteAsync(Response, SupportRules.EventKey(id), watch, json.Value.JsonSerializerOptions, ct);
        return new EmptyResult();
    }
}

public sealed record SupportMessageRequest(string? Body, string? Source, string? Path, string? Name, string? Email);

/// <summary>Live support, the console's side: the inbox, a thread, an answer, close and reopen.</summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/support")]
public sealed class AdminSupportController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminSupportController(ISender sender) => _sender = sender;

    [HttpGet("conversations")]
    public async Task<IActionResult> Inbox([FromQuery] bool closed = true, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetSupportInboxQuery(closed), ct));

    /// <summary>Threads with something unread: the nav badge.</summary>
    [HttpGet("unread")]
    public async Task<IActionResult> Unread(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSupportUnreadQuery(), ct));

    [HttpGet("conversations/{id:guid}")]
    public async Task<IActionResult> Conversation(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSupportConversationQuery(id), ct));

    [HttpPost("conversations/{id:guid}/messages")]
    public async Task<IActionResult> Reply(Guid id, AdminSupportReplyRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new ReplySupportCommand(id, body.Body), ct));

    [HttpPost("conversations/{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SetSupportClosedCommand(id, true), ct));

    [HttpPost("conversations/{id:guid}/reopen")]
    public async Task<IActionResult> Reopen(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new SetSupportClosedCommand(id, false), ct));
}

public sealed record AdminSupportReplyRequest(string? Body);
