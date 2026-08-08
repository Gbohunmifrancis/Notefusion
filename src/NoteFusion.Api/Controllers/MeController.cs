using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Me.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>The current user's own profile (F: self-service profile).</summary>
[Authorize]
[Route("api/me")]
public sealed class MeController : ApiControllerBase
{
    private readonly ISender _sender;

    public MeController(ISender sender) => _sender = sender;

    /// <summary>Returns the authenticated user's profile.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMyProfileQuery(), ct));

    /// <summary>Updates the authenticated user's name and phone number.</summary>
    [HttpPut]
    public async Task<IActionResult> Update(UpdateMyProfileCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Closes the authenticated user's account, taking their library with it. Irreversible;
    /// the current password is re-checked in the handler before anything is removed.
    /// </summary>
    [HttpDelete]
    public async Task<IActionResult> Delete(DeleteMyAccountCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
