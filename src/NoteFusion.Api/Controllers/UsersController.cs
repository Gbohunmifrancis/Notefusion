using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Users.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>Admin-only user administration.</summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
public sealed class UsersController : ApiControllerBase
{
    private readonly ISender _sender;

    public UsersController(ISender sender) => _sender = sender;

    /// <summary>Creates a user (admin only).</summary>
    [HttpPost]
    public async Task<IActionResult> Create(CreateUserCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));
}
