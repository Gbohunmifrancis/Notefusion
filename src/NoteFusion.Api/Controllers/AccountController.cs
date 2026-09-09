using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Auth.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Public account-level operations such as the web deletion portal required by Google Play Data Safety policy.
/// </summary>
[AllowAnonymous]
[Route("api/account")]
[Route("api/v1/account")]
public sealed class AccountController : ApiControllerBase
{
    private readonly ISender _sender;

    public AccountController(ISender sender) => _sender = sender;

    /// <summary>
    /// Initiates or completes account and data deletion from the web deletion portal.
    /// Supports password-verified immediate deletion, token-confirmed deletion, or emailing a confirmation link.
    /// </summary>
    [EnableRateLimiting(AuthRateLimiting.EmailDispatch)]
    [HttpPost("delete")]
    public async Task<IActionResult> Delete(DeleteAccountRequestCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Confirms account and data deletion using the token emailed to the user.
    /// </summary>
    [EnableRateLimiting(AuthRateLimiting.EmailDispatch)]
    [HttpPost("delete/confirm")]
    public async Task<IActionResult> ConfirmDelete(DeleteAccountRequestCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));
}
