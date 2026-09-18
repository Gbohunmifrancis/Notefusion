using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Waitlist.Commands;

namespace NoteFusion.Api.Controllers;

public sealed record JoinWaitlistRequest(
    string Email,
    string? Name = null,
    string? Role = null,
    string? Source = null);

/// <summary>
/// Public endpoints for prospective users joining the NoteFusion waitlist.
/// </summary>
[AllowAnonymous]
[EnableRateLimiting(AuthRateLimiting.EmailDispatch)]
[Route("api/waitlist")]
public sealed class WaitlistController : ApiControllerBase
{
    private readonly ISender _sender;

    public WaitlistController(ISender sender) => _sender = sender;

    /// <summary>
    /// Joins the early access waitlist. Rejects duplicate emails with 409 Conflict.
    /// </summary>
    [HttpPost]
    [ProducesResponseType(typeof(WaitlistEntryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Join(
        [FromBody] JoinWaitlistRequest request, CancellationToken ct)
    {
        var command = new JoinWaitlistCommand(
            request.Email,
            request.Name,
            request.Role,
            request.Source);

        return HandleResult(await _sender.Send(command, ct));
    }
}
