using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Queries;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Subscription billing for the mobile app (F-monetization). The app never collects card details: it
/// lists plans, asks to start a checkout, and opens the returned provider URL in an external browser
/// (Spotify-style). The real payment result arrives out-of-band via the provider webhook, so the app
/// polls <c>my-subscription</c> to learn when Pro unlocks.
/// </summary>
[Authorize]
[Route("api/billing")]
public sealed class BillingController : ApiControllerBase
{
    private readonly ISender _sender;

    public BillingController(ISender sender) => _sender = sender;

    /// <summary>Lists the plans shown on the paywall, cheapest first.</summary>
    [HttpGet("plans")]
    public async Task<IActionResult> Plans(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPlansQuery(), ct));

    /// <summary>
    /// Starts a hosted-checkout session for a plan and returns the URL to open externally. Idempotent
    /// for an in-flight checkout: tapping "Upgrade" twice returns the same session, never a second charge.
    /// </summary>
    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout(CheckoutBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new InitiateCheckoutCommand(body.PlanId), ct));

    /// <summary>The caller's subscription state — the app gates Pro features on this.</summary>
    [HttpGet("my-subscription")]
    public async Task<IActionResult> MySubscription(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMySubscriptionQuery(), ct));

    /// <summary>Total revenue balance, summed from the immutable ledger. Admin only.</summary>
    [HttpGet("ledger-balance")]
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    public async Task<IActionResult> LedgerBalance(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetLedgerBalanceQuery(), ct));

    /// <summary>Body for a checkout request (plan chosen by id; provider is picked server-side).</summary>
    public sealed record CheckoutBody(Guid PlanId);
}
