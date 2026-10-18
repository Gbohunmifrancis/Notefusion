using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Flags.Commands;
using NoteFusion.Application.Flags.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The console's Feature flags page (Operations): the switches that change what everyone sees — the Christmas season
/// first. Every change is written to the audit log with who made it. Everyone else reads the season at
/// <c>GET /api/app/season</c>.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/features")]
public sealed class AdminFeaturesController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminFeaturesController(ISender sender) => _sender = sender;

    /// <summary>Every flag as it stands (off when never changed), with when and by whom it was last changed.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetFeatureFlagsQuery(), ct));

    /// <summary>
    /// Changes any of <c>enabled</c>, <c>adminPreview</c>, <c>autoOff</c> (false: stays on until switched off) and
    /// <c>autoOffAt</c> (the last day it is on, <c>yyyy-mm-dd</c>, West Africa Time); what is left out stays as it is. 404
    /// <c>FEATURE_FLAG_UNKNOWN</c> for a key there is no flag for; 422 <c>FEATURE_FLAG_AUTO_OFF_PASSED</c> for switching it
    /// on with a last day already gone. Answers with the flag as it now stands.
    /// </summary>
    [HttpPut("{key}")]
    public async Task<IActionResult> Set(string key, SetFeatureFlagRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(
            new SetFeatureFlagCommand(key, body.Enabled, body.AdminPreview, body.AutoOff, body.AutoOffAt), ct));
}

/// <summary>JSON body of <c>PUT /api/admin/features/{key}</c>: any of the four; what is left out stays as it is.</summary>
public sealed record SetFeatureFlagRequest(bool? Enabled, bool? AdminPreview, bool? AutoOff, DateOnly? AutoOffAt);
