using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Choirs.Commands;
using NoteFusion.Application.Choirs.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The choir plan: one director pays, the singers who join with the choir's invite code are Pro, and the
/// choir shares one library. "mine" is the caller's choir, as director or singer; managing it is the
/// director's alone.
/// </summary>
[Authorize]
[Route("api/choirs")]
public sealed class ChoirsController : ApiControllerBase
{
    private readonly ISender _sender;

    public ChoirsController(ISender sender) => _sender = sender;

    /// <summary>The caller's choir (404 <c>CHOIR_NOT_FOUND</c> when they are in none).</summary>
    [HttpGet("mine")]
    public async Task<IActionResult> Mine(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMyChoirQuery(), ct));

    /// <summary>Renames the choir. Director only.</summary>
    [HttpPut("mine")]
    public async Task<IActionResult> Rename(RenameChoirBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RenameChoirCommand(body.Name), ct));

    /// <summary>The singers in the choir. Director only.</summary>
    [HttpGet("mine/members")]
    public async Task<IActionResult> Members(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetChoirMembersQuery(), ct));

    /// <summary>Takes a singer out of the choir. Director only.</summary>
    [HttpDelete("mine/members/{userId:guid}")]
    public async Task<IActionResult> RemoveMember(Guid userId, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new RemoveChoirMemberCommand(userId), ct));

    /// <summary>A new invite code; the old one stops working. Director only.</summary>
    [HttpPost("mine/invite")]
    public async Task<IActionResult> RegenerateInvite(CancellationToken ct)
        => HandleResult(await _sender.Send(new RegenerateChoirInviteCommand(), ct));

    /// <summary>Joins a choir with its invite code. Rate-limited like a sign-in, since a code is a way in.</summary>
    [HttpPost("join")]
    [EnableRateLimiting(AuthRateLimiting.Credentials)]
    public async Task<IActionResult> Join(JoinChoirBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new JoinChoirCommand(body.Code), ct));

    /// <summary>A singer leaves their choir.</summary>
    [HttpPost("leave")]
    public async Task<IActionResult> Leave(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new LeaveChoirCommand(), ct));

    /// <summary>The choir's shared library.</summary>
    [HttpGet("mine/sheets")]
    public async Task<IActionResult> Sheets(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetChoirSheetsQuery(), ct));

    /// <summary>One sheet of the choir's library, read-only.</summary>
    [HttpGet("mine/sheets/{id:guid}")]
    public async Task<IActionResult> Sheet(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetChoirSheetQuery(id), ct));

    /// <summary>Shares one of the caller's own saved sheets with their choir.</summary>
    [HttpPut("mine/sheets/{id:guid}")]
    public async Task<IActionResult> Share(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new ShareSheetWithChoirCommand(id), ct));

    /// <summary>Takes a sheet out of the choir's library: the sharer's own, or any for the director.</summary>
    [HttpDelete("mine/sheets/{id:guid}")]
    public async Task<IActionResult> Unshare(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new UnshareSheetFromChoirCommand(id), ct));
}

public sealed record RenameChoirBody(string? Name);

public sealed record JoinChoirBody(string? Code);
