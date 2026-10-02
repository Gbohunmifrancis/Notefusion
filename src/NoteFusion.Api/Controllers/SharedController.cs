using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Library.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Sheets behind public links. Anonymous by design: a chorister who follows a link pasted into
/// the choir group should see the sheet without an account. The token is the credential.
/// </summary>
[AllowAnonymous]
[Route("api/shared")]
public sealed class SharedController : ApiControllerBase
{
    private readonly ISender _sender;

    public SharedController(ISender sender) => _sender = sender;

    [HttpGet("{token}")]
    public async Task<IActionResult> Get(string token, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetSharedTranscriptionQuery(token), ct));
}
