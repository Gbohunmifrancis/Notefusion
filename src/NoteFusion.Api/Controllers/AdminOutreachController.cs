using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Outreach.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The founder's customer-research outreach, for the admin console: whether it is sending, how many accounts
/// each segment has reached, and the newest sends with their status.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/outreach")]
public sealed class AdminOutreachController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminOutreachController(ISender sender) => _sender = sender;

    /// <param name="take">How many recent sends to list; 1–200, default 100.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int take = 100, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetOutreachQuery(take), ct));
}
