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
/// (Spotify-style). The authoritative payment result still arrives out-of-band via the provider webhook,
/// but the app does not wait for it: on returning from checkout it calls <c>confirm</c>, which asks the
/// provider directly, so Pro unlocks in a round trip rather than whenever the webhook lands.
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
    /// The anonymous marketing-site offer. It resolves the request location and returns only that region's
    /// plans; if location cannot be trusted, the response contains no paid plans rather than both prices.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("public-plans")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> PublicPlans(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPublicPricingQuery(), ct));

    /// <summary>
    /// Starts a hosted-checkout session for a plan and returns the URL to open externally. Idempotent
    /// for an in-flight checkout: tapping "Upgrade" twice returns the same session, never a second charge.
    /// </summary>
    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout(CheckoutBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new InitiateCheckoutCommand(body.PlanId, body.Client), ct));

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

    /// <summary>
    /// The same hop for a checkout started on the website (<c>client: "web"</c>): back to the site's app
    /// page, which confirms the payment on load. Anonymous and outcome-neutral for the same reasons.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("return/web")]
    [Produces("text/html")]
    public IActionResult ReturnWeb() => Content(WebReturnPage, "text/html; charset=utf-8");

    /// <summary>The caller's subscription state — the app gates Pro features on this.</summary>
    [HttpGet("my-subscription")]
    public async Task<IActionResult> MySubscription(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMySubscriptionQuery(), ct));

    /// <summary>
    /// Asks the provider whether the caller's in-flight checkout was paid, and returns the resulting
    /// subscription state. The app sends this as soon as the checkout browser closes, which turns
    /// "Pro unlocks whenever the provider's webhook arrives" into a single round trip. Takes no body:
    /// the transaction is chosen from the authenticated identity, never supplied by the caller.
    /// </summary>
    [HttpPost("confirm")]
    public async Task<IActionResult> Confirm(CancellationToken ct)
        => HandleResult(await _sender.Send(new ConfirmPaymentCommand(), ct));

    /// <summary>
    /// Cancels the caller's subscription at the end of the period they have already paid for. Pro is not
    /// withdrawn early and nothing is refunded; what changes is that the expiring-soon notice stops
    /// saying the plan renews. Idempotent — cancelling twice returns 204 and changes nothing.
    /// </summary>
    [HttpPost("cancel")]
    public async Task<IActionResult> Cancel(CancellationToken ct)
        => HandleNoContent(await _sender.Send(new CancelSubscriptionCommand(), ct));

    /// <summary>Total revenue balance, summed from the immutable ledger. Admin only.</summary>
    [HttpGet("ledger-balance")]
    [Authorize(Policy = AuthorizationPolicies.Admin)]
    public async Task<IActionResult> LedgerBalance(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetLedgerBalanceQuery(), ct));

    /// <summary>
    /// Body for a checkout request (plan chosen by id; provider is picked server-side). <c>Client</c> is
    /// optional; <c>"web"</c> returns the browser to the website after paying instead of to the app.
    /// </summary>
    public sealed record CheckoutBody(Guid PlanId, string? Client = null);

    /// <summary>
    /// The deep link the app listens for. Must stay identical to <c>RETURN_URL</c> in
    /// mobile/src/screens/UpgradeScreen.tsx and to <c>expo.scheme</c> in app.json — if it drifts, the
    /// in-app browser never recognises the return and sits on this page until the user backs out.
    /// </summary>
    private const string AppReturnLink = "notefusion://billing/return";

    /// <summary>Where a checkout started from the website (web-site/app) lands; the page confirms the payment on load.</summary>
    private const string WebReturnLink = "https://notefusion.studio/app?paid=1";

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
          <p style="margin-top:.5rem"><a href="{{WebReturnLink}}" style="background:none;color:#9AA7BF;padding:0;font-weight:500;text-decoration:underline">Paid on the website? Go back to NoteFusion Web</a></p>
          <script>location.replace("{{AppReturnLink}}");</script>
        </body>
        </html>
        """;

    /// <summary>
    /// The website's return page: the same look, but it goes back to the site rather than the app. The
    /// button is there for a browser that blocks the scripted jump.
    /// </summary>
    private const string WebReturnPage = $$"""
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
          <p>We're confirming your payment.</p>
          <a href="{{WebReturnLink}}">Back to NoteFusion</a>
          <script>location.replace("{{WebReturnLink}}");</script>
        </body>
        </html>
        """;
}
