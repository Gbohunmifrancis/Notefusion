using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Practice.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The practice reminder sweep, for the admin console: whether it is sending, a week's reminders by kind, and the
/// newest claim rows with what each said and how its send went.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/practice-reminders")]
public sealed class AdminPracticeRemindersController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminPracticeRemindersController(ISender sender) => _sender = sender;

    /// <param name="take">How many recent reminders to list; 1–200, default 100.</param>
    /// <param name="ct">Cancellation token.</param>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int take = 100, CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetPracticeReminderLogQuery(take), ct));
}
