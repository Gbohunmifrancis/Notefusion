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

    /// <summary>
    /// The https landing page hosted checkout returns the browser to, whose only job is to hand off to
    /// the app's deep link. It exists because Bachs refuses a non-http(s) <c>success_url</c> outright
    /// (<c>VALIDATION_ERROR success_url must use http:// or https:// scheme</c>), so the deep link
    /// cannot be given to the provider directly. Anonymous — the returning browser carries no token —
    /// and it deliberately claims nothing about the outcome: a redirect is not evidence of payment, and
    /// the real result arrives out-of-band by webhook.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("return")]
    [Produces("text/html")]
    public IActionResult Return() => Content(ReturnPage, "text/html; charset=utf-8");

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

    /// <summary>
    /// The deep link the app listens for. Must stay identical to <c>RETURN_URL</c> in
    /// mobile/src/screens/UpgradeScreen.tsx and to <c>expo.scheme</c> in app.json — if it drifts, the
    /// in-app browser never recognises the return and sits on this page until the user backs out.
    /// </summary>
    private const string AppReturnLink = "notefusion://billing/return";

    /// <summary>
    /// Self-contained markup rather than a static file, so the hop cannot break on a missing asset in a
    /// build that ships without the dashboard bundle. The script handles the normal case; the button is
    /// there for browsers that refuse a scripted jump to a non-http scheme without a tap.
    /// </summary>
    private const string ReturnPage = $$"""
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Returning to NoteFusion…</title>
        <style>
          body { margin:0; min-height:100vh; box-sizing:border-box; padding:2rem;
                 display:flex; flex-direction:column; align-items:center; justify-content:center;
                 gap:1.25rem; text-align:center; background:#0B1220; color:#E8EDF7;
                 font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          h1 { margin:0; font-size:1.25rem; font-weight:600; }
          p { margin:0; max-width:22rem; color:#9AA7BF; }
          a { display:inline-block; padding:.75rem 1.5rem; border-radius:999px;
              background:#F2C14E; color:#0B1220; font-weight:600; text-decoration:none; }
        </style>
        </head>
        <body>
          <h1>Returning to NoteFusion…</h1>
          <p>We're confirming your payment. You can close this tab once the app reopens.</p>
          <a href="{{AppReturnLink}}">Open NoteFusion</a>
          <script>location.replace("{{AppReturnLink}}");</script>
        </body>
        </html>
        """;
}
