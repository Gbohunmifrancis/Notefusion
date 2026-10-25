using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
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

    /// <summary>The choir plans this account may buy (one director pays, the singers are Pro), cheapest first.</summary>
    [HttpGet("plans/choir")]
    public async Task<IActionResult> ChoirPlans(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPlansQuery(Choir: true), ct));

    /// <summary>
    /// The one-song purchase this account may buy (one transcription, no membership); empty for a Pro member.
    /// Listed apart from <c>plans</c> because older clients label every plan there as a month or year of Pro.
    /// </summary>
    [HttpGet("plans/single")]
    public async Task<IActionResult> SinglePlans(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPlansQuery(Single: true), ct));

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
    [EnableRateLimiting(AuthRateLimiting.Billing)]
    public async Task<IActionResult> Checkout(CheckoutBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new InitiateCheckoutCommand(body.PlanId, body.Client, body.OfferKey), ct));

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
    public IActionResult Return() => Page(ReturnPage, AppReturnScript);

    /// <summary>
    /// The same hop for a checkout started on the website (<c>client: "web"</c>): back to the site's app
    /// page, which confirms the payment on load. Anonymous and outcome-neutral for the same reasons.
    /// </summary>
    [AllowAnonymous]
    [HttpGet("return/web")]
    [Produces("text/html")]
    public IActionResult ReturnWeb() => Page(WebReturnPage, WebReturnScript);

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
    [EnableRateLimiting(AuthRateLimiting.Billing)]
    [NoActivity] // asked on every return to the app: the handler records a return only when a checkout was open
    public async Task<IActionResult> Confirm(CancellationToken ct)
        => HandleResult(await _sender.Send(new ConfirmPaymentCommand(), ct));

    /// <summary>
    /// "What stopped you?": the caller came back from their checkout's payment page without paying. <c>id</c> is the
    /// checkout's <c>reference</c> from <c>checkout</c>; the body says how long the page was open and, once they tap
    /// one, why they stopped. The return is recorded the first time and the answer at most once; a paid checkout
    /// records nothing. The reply says whether to ask. 404 for a checkout that is not the caller's.
    /// </summary>
    [HttpPost("checkouts/{id}/exit")]
    [EnableRateLimiting(AuthRateLimiting.Billing)]
    public async Task<IActionResult> CheckoutExit(string id, CheckoutExitBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RecordCheckoutExitCommand(id, body.SecondsOpen, body.Reason, body.Note), ct));

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
    /// optional; <c>"web"</c> returns the browser to the website after paying instead of to the app. <c>OfferKey</c>
    /// (optional) asks for a live seasonal offer's price; 409 <c>BILLING_OFFER_ENDED</c> when it no longer applies.
    /// </summary>
    public sealed record CheckoutBody(Guid PlanId, string? Client = null, string? OfferKey = null);

    /// <summary>
    /// Body for a checkout's exit: seconds the payment page was open by the client's clock, and the one-tap reason
    /// (<c>"currency"</c>, <c>"cardDeclined"</c>, <c>"slow"</c>, <c>"tooExpensive"</c>, <c>"justLooking"</c>,
    /// <c>"somethingElse"</c>) with an optional note of at most 280 characters, once they answer.
    /// </summary>
    public sealed record CheckoutExitBody(int SecondsOpen, Core.Enums.CheckoutExitReason? Reason = null, string? Note = null);

    /// <summary>
    /// The deep link the app listens for. Must stay identical to <c>RETURN_URL</c> in
    /// mobile/src/screens/UpgradeScreen.tsx and to <c>expo.scheme</c> in app.json — if it drifts, the
    /// in-app browser never recognises the return and sits on this page until the user backs out.
    /// </summary>
    private const string AppReturnLink = "notefusion://billing/return";

    /// <summary>Where a checkout started from the website (web-site/app) lands; the page confirms the payment on load.</summary>
    private const string WebReturnLink = "https://notefusion.studio/app?paid=1";

    /// <summary>The return pages' only scripts, kept apart so their hashes can go in the pages' policy.</summary>
    private const string AppReturnScript = $"location.replace(\"{AppReturnLink}\");";
    private const string WebReturnScript = $"location.replace(\"{WebReturnLink}\");";

    /// <summary>
    /// The return pages' own Content-Security-Policy, in place of the API's "nothing may run" one: the inline
    /// style is allowed, and the inline script only by its hash, so nothing else could run on the page even
    /// if something were ever injected into it.
    /// </summary>
    internal static string ReturnPagePolicy(string script)
        => "default-src 'none'; style-src 'unsafe-inline'; "
           + $"script-src 'sha256-{Convert.ToBase64String(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(script)))}'; "
           + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    private ContentResult Page(string html, string script)
    {
        Response.Headers.ContentSecurityPolicy = ReturnPagePolicy(script);
        return Content(html, "text/html; charset=utf-8");
    }

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
          <script>{{AppReturnScript}}</script>
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
          <script>{{WebReturnScript}}</script>
        </body>
        </html>
        """;
}
