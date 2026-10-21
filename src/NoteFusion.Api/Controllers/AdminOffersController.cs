using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Offers;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The console's Offers page (Operations): seasonal Pro discounts and the email that tells people. Admins only, behind
/// the console lock like every admin route; switching an offer on or off and sending its email also want a fresh
/// unlock. Every change is written to the audit log.
/// </summary>
[Authorize(Policy = AuthorizationPolicies.Admin)]
[Route("api/admin/offers")]
public sealed class AdminOffersController : ApiControllerBase
{
    private readonly ISender _sender;

    public AdminOffersController(ISender sender) => _sender = sender;

    /// <summary>Every offer, the newest start first.</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetAdminOffersQuery(), ct));

    /// <summary>Each template's defaults for the year ahead (name, dates, 30%, words).</summary>
    [HttpGet("templates")]
    public async Task<IActionResult> Templates(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetOfferTemplatesQuery(), ct));

    /// <summary>A new offer, switched off; what is left out comes from its template.</summary>
    [HttpPost]
    public async Task<IActionResult> Create(OfferBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new CreateOfferCommand(
            body.Template ?? string.Empty, body.Name, body.PercentOff, body.IncludesMonthly, body.IncludesYearly,
            body.StartsAtUtc, body.LastDay, body.Words), ct));

    /// <summary>Changes an offer; what is left out stays. Once underway only a later last day; the words lock once sent.</summary>
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, OfferBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateOfferCommand(
            id, body.Template, body.Name, body.PercentOff, body.IncludesMonthly, body.IncludesYearly,
            body.StartsAtUtc, body.LastDay, body.Words), ct));

    /// <summary>Switches an offer on (refused if it overlaps another or has ended) or off.</summary>
    [HttpPut("{id:guid}/enabled")]
    [FreshPhoneUnlock]
    public async Task<IActionResult> SetEnabled(Guid id, OfferEnabledBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetOfferEnabledCommand(id, body.Enabled), ct));

    /// <summary>The email as it goes out, for someone on <paramref name="set"/> prices called <paramref name="firstName"/>.</summary>
    [HttpGet("{id:guid}/preview")]
    public async Task<IActionResult> Preview(Guid id, [FromQuery] string? set, [FromQuery] string? firstName, CancellationToken ct)
        => HandleResult(await _sender.Send(new PreviewOfferEmailQuery(id, set, firstName), ct));

    /// <summary>Sends the email to the signed-in admin's own address, on <c>set</c> prices.</summary>
    [HttpPost("{id:guid}/test")]
    public async Task<IActionResult> Test(Guid id, OfferTestBody? body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SendOfferTestCommand(id, body?.Set), ct));

    /// <summary>Who Send would reach with these groups, who never would and why, and the quota's pace.</summary>
    [HttpGet("{id:guid}/audience")]
    public async Task<IActionResult> Audience(
        Guid id, [FromQuery] bool free = true, [FromQuery] bool lapsed = true, [FromQuery] bool proNow = false,
        CancellationToken ct = default)
        => HandleResult(await _sender.Send(new GetOfferAudienceQuery(id, free, lapsed, proNow), ct));

    /// <summary>Queues the email for the ticked groups and locks its words. Once per offer.</summary>
    [HttpPost("{id:guid}/send")]
    [FreshPhoneUnlock]
    public async Task<IActionResult> Send(Guid id, OfferSendBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SendOfferCommand(id, body.Free, body.Lapsed, body.ProNow), ct));

    /// <summary>Pauses or resumes the email's queue.</summary>
    [HttpPut("{id:guid}/sending")]
    public async Task<IActionResult> Sending(Guid id, OfferSendingBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetOfferSendingCommand(id, body.Paused), ct));

    /// <summary>The email's queue, its clicks and what the offer sold.</summary>
    [HttpGet("{id:guid}/progress")]
    public async Task<IActionResult> Progress(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetOfferProgressQuery(id), ct));
}

/// <summary>
/// JSON body of <c>POST /api/admin/offers</c> and <c>PUT /api/admin/offers/{id}</c>. <c>template</c> is "halloween" or
/// "christmas"; <c>lastDay</c> is <c>yyyy-mm-dd</c>; <c>words</c> is {subject, preheader, headline, body}.
/// </summary>
public sealed record OfferBody(
    string? Template,
    string? Name,
    int? PercentOff,
    bool? IncludesMonthly,
    bool? IncludesYearly,
    DateTime? StartsAtUtc,
    DateOnly? LastDay,
    OfferWords? Words);

public sealed record OfferEnabledBody(bool Enabled);

/// <summary><c>set</c>: "standard" (the default) or "regional".</summary>
public sealed record OfferTestBody(string? Set);

public sealed record OfferSendBody(bool Free, bool Lapsed, bool ProNow);

public sealed record OfferSendingBody(bool Paused);
