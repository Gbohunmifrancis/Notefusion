using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Starts a hosted-checkout session for a plan (F-monetization). The provider is chosen by the plan's
/// currency, not by the client. A <see cref="PaymentTransaction"/> is persisted <c>Pending</c> BEFORE
/// the provider is called, so a crash mid-initiation still leaves an auditable row; an in-flight
/// checkout for the same user+plan is reused rather than duplicated, so a double-tap never
/// double-charges. A retry after a failed initiation resumes the same Pending row — same reference, same
/// idempotency key — so the provider replays the original session instead of opening a second charge.
/// </summary>
/// <param name="Client">
/// Where the customer is paying from. <c>"web"</c> sends the browser back to the website after checkout
/// instead of handing off to the app's deep link; anything else (or nothing) is the app.
/// </param>
/// <param name="OfferKey">
/// A seasonal offer's key (<c>halloween-2026</c>): charge the offer's price instead of the plan's own. Only while that
/// offer is live for this account (its own time zone) and covers the plan; else <c>BILLING_OFFER_ENDED</c> and the
/// client shows the usual price. A checkout opened at the offer price keeps it for the reuse window, even past the end.
/// Without a key the plan's own price, and only checkouts opened at it are reused: the two never share a session.
/// </param>
public sealed record InitiateCheckoutCommand(Guid PlanId, string? Client = null, string? OfferKey = null)
    : IRequest<Result<CheckoutSessionDto>>;

public sealed class InitiateCheckoutCommandValidator : AbstractValidator<InitiateCheckoutCommand>
{
    public InitiateCheckoutCommandValidator()
        => RuleFor(x => x.PlanId).NotEmpty().WithMessage("Please choose a plan.");
}

public sealed class InitiateCheckoutCommandHandler : IRequestHandler<InitiateCheckoutCommand, Result<CheckoutSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;
    private readonly IEmailSender _email;
    private readonly IClientTimeZone? _timeZone;

    public InitiateCheckoutCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IPaymentGatewayFactory gateways,
        IDateTimeProvider clock,
        BillingSettings settings,
        IEmailSender email,
        IClientTimeZone? timeZone = null)
    {
        _db = db;
        _currentUser = currentUser;
        _gateways = gateways;
        _clock = clock;
        _settings = settings;
        _email = email;
        _timeZone = timeZone;
    }

    public async Task<Result<CheckoutSessionDto>> Handle(InitiateCheckoutCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return BillingErrors.NotAuthenticated;

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == request.PlanId && p.IsActive, ct);
        if (plan is null)
            return BillingErrors.PlanNotFound;

        // The list endpoint already hides ineligible plans, and that is not enough: this command takes a raw
        // PlanId, so any signed-in caller can post the id of a plan they were never shown. This is the check
        // that actually holds — before the transaction row, so a refused attempt leaves no audit trail to
        // reconcile later.
        if (!PlanEligibility.IsOffered(plan.Code, plan.Currency, user.Country))
            return BillingErrors.PlanNotAvailableInRegion;

        // One transcription is worth nothing to a member, whose plan already includes every one. Hidden from
        // their paywall, and refused here for the same reason the region is: the list is advice.
        var isSingle = plan.Interval == BillingInterval.Single;
        if (isSingle && await ProStatus.IsProAsync(_db, _clock, userId, ct))
            return BillingErrors.SingleNotNeededOnPro;

        // Nothing bills off-session, so a member buying again is how Pro continues: the payment adds a
        // period after the one already paid for (PaymentFulfillment stacks it), on whichever plan they
        // chose. Only lifetime access has nothing left to buy. Ordered as GetMySubscriptionQuery orders
        // it, so this is the membership the app is showing.
        var current = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (!plan.IsChoir && current is not null && current.IsLifetime && current.IsActiveAt(_clock.UtcNow))
            return BillingErrors.AlreadyLifetime;

        // Google Play renews this membership itself: a website payment on top would charge twice for one period.
        if (!isSingle && !plan.IsChoir && current is not null && current.Provider == PaymentProvider.GooglePlay
            && current.IsActiveAt(_clock.UtcNow))
        {
            return BillingErrors.ManagedByGooglePlay;
        }
        if (plan.IsChoir
            && await _db.Choirs.AnyAsync(
                c => c.OwnerId == userId && c.Provider == PaymentProvider.GooglePlay && c.CurrentPeriodEndUtc > _clock.UtcNow, ct))
        {
            return BillingErrors.ManagedByGooglePlay;
        }

        // A choir plan is the director's: it extends a choir they lead, or starts one. An account sings in one
        // choir, so a singer in someone else's running choir leaves it before starting their own.
        if (plan.IsChoir
            && await _db.ChoirMembers.AnyAsync(
                m => m.UserId == userId
                     && _db.Choirs.Any(c => c.Id == m.ChoirId && c.CurrentPeriodEndUtc > _clock.UtcNow), ct))
        {
            return ChoirErrors.MemberOfAnotherChoir;
        }

        // A seasonal offer asked for by key. An unknown key is an ended offer to the client: the usual price.
        Offer? offer = null;
        var offerKey = request.OfferKey?.Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(offerKey))
        {
            offer = await _db.Offers.AsNoTracking().FirstOrDefaultAsync(o => o.Key == offerKey, ct);
            if (offer is null)
                return OfferErrors.CheckoutOfferEnded(null);
        }
        var offerId = offer?.Id;

        // Retry-safe: an existing in-flight checkout for this user+plan is reused, so tapping "Upgrade"
        // twice returns the same session instead of opening a second charge. Only one opened at the same price:
        // a checkout at the offer's price and one at the plan's own are never handed out for each other, and one at
        // the offer's price is handed back even when the offer has ended since (it keeps its price for the window).
        var fromWeb = IsWebClient(request.Client);
        var inFlight = await _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.PlanId == plan.Id
                        && t.OfferId == offerId
                        && t.Status == PaymentStatus.Processing
                        && t.CheckoutUrl != null)
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
        if (inFlight is not null)
        {
            // Only while the session can still be paid. A Processing row's UpdatedAtUtc is the moment its
            // checkout was attached, and a hosted session dies (Bachs: after an hour) whether or not anyone
            // tells us — handing an old one back would send the customer to a page that cannot take money.
            // And only to the client that opened it: the session returns the browser to that client's page
            // (the app's deep link or the website), so the other one would be left on the wrong page after paying.
            var reuseCutoff = _clock.UtcNow - TimeSpan.FromMinutes(Math.Max(1, _settings.CheckoutReuseMinutes));
            var sameClient = inFlight.IdempotencyKey.EndsWith(WebKeySuffix, StringComparison.Ordinal) == fromWeb;
            if (sameClient && inFlight.UpdatedAtUtc >= reuseCutoff)
                return new CheckoutSessionDto(inFlight.Reference, inFlight.CheckoutUrl!, inFlight.Provider);

            // Too old to hand out, or the other client's, but it may have been paid without our hearing of it —
            // often the very reason the customer is back. Ask first, because the answer decides whether a new
            // charge is wanted at all. A failed ask does not block the purchase: the row stays for the sweep.
            _ = await ReconcilePaymentCommandHandler.ReconcileAsync(_db, _gateways, _clock, _email, inFlight, ct);
            if (inFlight.Status == PaymentStatus.Completed)
            {
                var updated = await _db.Subscriptions
                    .OrderByDescending(s => s.CurrentPeriodEndUtc)
                    .FirstOrDefaultAsync(s => s.UserId == userId, ct);
                if (isSingle)
                    return EarlierSingleLanded;
                if (plan.IsChoir)
                    return EarlierPaymentLanded;
                return updated is not null && updated.IsLifetime && updated.IsActiveAt(_clock.UtcNow)
                    ? BillingErrors.AlreadyLifetime
                    : EarlierPaymentLanded;
            }
        }

        // The offer's price, while it is live where this account is and covers this plan (Pro Monthly or Yearly in
        // dollars; the region was checked above). Past that, the client is told and shows the usual price again.
        var amountMinor = plan.AmountMinor;
        if (offer is not null)
        {
            var zone = OfferWindow.Resolve(user.TimeZone, _timeZone?.Current);
            if (!OfferWindow.IsLiveFor(offer, zone, _clock.UtcNow) || !OfferPlans.Includes(offer, plan))
                return OfferErrors.CheckoutOfferEnded(OfferErrors.LabelFor(offer.Template));
            amountMinor = OfferPricing.Price(plan.AmountMinor, offer.PercentOff);
        }

        // A currency nothing can collect is a configuration fault, not something the customer can act on,
        // so it reads as the same plain "could not open the payment page" as any other initiation failure.
        var gatewayResult = _gateways.SelectForCurrency(plan.Currency);
        if (gatewayResult.IsFailure)
            return BillingErrors.GatewayInitiationFailed;
        var gateway = gatewayResult.Value;

        var now = _clock.UtcNow;

        // A row still Pending means a previous attempt persisted its audit trail but never got a checkout
        // URL back — the provider timed out, the process died, or the network dropped the response. Reusing
        // that row (and therefore its reference and idempotency key) is what makes the retry safe: the
        // provider recognises the replayed key and returns the ORIGINAL session, so a user who was already
        // debited on the invisible first attempt is not charged again. Minting a fresh key here instead
        // would make every retry a brand-new charge, which is exactly the duplicate we must never create.
        // Narrowed on provider/amount/currency so a re-priced plan or a re-routed provider starts clean
        // rather than replaying a key the provider fingerprinted against a different body. The return URL is
        // part of that body too, so a row is only replayed by the client (app or website) that started it:
        // the other one's URL under the same key is a key conflict, which leaves the outcome unknown and
        // would refuse that client's every attempt until the stale sweep closed the row.
        var pending = _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.PlanId == plan.Id
                        && t.Status == PaymentStatus.Pending
                        && t.Provider == gateway.Provider
                        && t.AmountMinor == amountMinor
                        && t.OfferId == offerId
                        && t.Currency == plan.Currency);
        pending = fromWeb
            ? pending.Where(t => t.IdempotencyKey.EndsWith(WebKeySuffix))
            : pending.Where(t => !t.IdempotencyKey.EndsWith(WebKeySuffix));
        var transaction = await pending
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);

        if (transaction is null)
        {
            var reference = $"NF_{Guid.NewGuid():N}";

            // Derived from the reference, not from a fresh Guid: the key must be stable across retries of
            // THIS initiation, and the reference already identifies it uniquely. The suffix records which
            // client started it, for the narrowing above.
            transaction = PaymentTransaction.Create(
                userId, plan.Id, gateway.Provider,
                fromWeb ? $"checkout:{reference}{WebKeySuffix}" : $"checkout:{reference}", reference,
                amountMinor, plan.Currency, now,
                fromWeb ? CheckoutClient.Web : CheckoutClient.Phone,
                offerId);

            // Persist PENDING before the provider is ever contacted (spec: durable audit row first).
            _db.PaymentTransactions.Add(transaction);
            await _db.SaveChangesAsync(ct);
        }

        var initiation = await gateway.InitiateAsync(
            new GatewayInitiationRequest(
                transaction.Reference, transaction.AmountMinor, plan.Currency, user.Email,
                CallbackUrlFor(request.Client, _settings.CheckoutCallbackUrl),
                // Every plan is a single charge for one period, priced from our own plan row. Bachs
                // subscription checkouts must be paid by a card it can save, and this account offers
                // no card method for USD, so a recurring session is refused outright
                // (CHECKOUT_CANNOT_SAVE_PAYMENT_METHOD); Paystack is initialised as a plain transaction
                // either way. A one-off needs no catalog product, so changing a price is a plan-row
                // change and nothing else.
                Recurring: false,
                transaction.IdempotencyKey, plan.Code,
                user.FullName),
            ct);

        if (initiation.IsFailure)
        {
            // Transient vs permanent, because the two need opposite treatment. A network error carries no
            // information about whether the provider opened a session, so burning the row to Failed would
            // strand a possibly-live checkout AND retire the only idempotency key that could reclaim it —
            // leave it Pending so the next attempt replays the same key. Only a definite refusal (bad
            // request, unsupported plan, auth failure) is a real terminal outcome worth telling the user
            // about; the reconciliation worker is what resolves anything left ambiguous.
            if (initiation.Error.Type == ErrorType.Network)
                return BillingErrors.GatewayInitiationFailed;

            transaction.MarkFailed(initiation.Error.Message, _clock.UtcNow);
            await _db.SaveChangesAsync(ct);

            // The upgrade never started, so tell the user rather than leaving them watching a checkout
            // that will never open. Best-effort and post-commit: a mail failure must not turn a handled
            // decline into a 500 the client shows as "try again", risking a real second charge later.
            await _email.SendPaymentFailedAsync(new EmailRecipient(user.Email, user.FullName), plan.Name, ct);

            return BillingErrors.GatewayInitiationFailed;
        }

        transaction.AttachCheckout(
            initiation.Value.ProviderReference, initiation.Value.CheckoutUrl, initiation.Value.Raw, _clock.UtcNow);
        await _db.SaveChangesAsync(ct);

        return new CheckoutSessionDto(transaction.Reference, transaction.CheckoutUrl!, transaction.Provider);
    }

    /// <summary>
    /// The customer's earlier checkout turned out to be paid when they came back to buy again. Opening a
    /// second charge on top of it would sell them a period they almost certainly did not mean to buy.
    /// </summary>
    private static readonly Error EarlierPaymentLanded =
        Error.Conflict("BILLING_PAYMENT_ALREADY_RECEIVED",
            "Good news: your earlier payment has gone through and Pro is now active. There is nothing more to pay.");

    /// <summary>
    /// The same, for a one-song purchase: the transcription it bought is already on the account. Same code,
    /// so the clients treat it as they do the Pro one — read the account again and say the payment landed.
    /// </summary>
    private static readonly Error EarlierSingleLanded =
        Error.Conflict("BILLING_PAYMENT_ALREADY_RECEIVED",
            "Good news: your earlier payment has gone through, so your song is paid for. There is nothing more to pay.");

    /// <summary>Ends the idempotency key of a checkout the website started; app keys carry no suffix.</summary>
    private const string WebKeySuffix = ":web";

    private static bool IsWebClient(string? client)
        => string.Equals(client?.Trim(), "web", StringComparison.OrdinalIgnoreCase);

    /// <summary>The path of the API's own return page, which the website's variant extends with <c>/web</c>.</summary>
    private const string ReturnPath = "/api/billing/return";

    /// <summary>
    /// Where the provider sends the browser back to. A checkout from the website returns to the API's
    /// <c>/api/billing/return/web</c> page, which goes back to the site; any other client gets the
    /// configured URL, which hands off to the app. Only a configured URL that is the API's own return page
    /// can be extended — anything else was set deliberately and is used as it stands.
    /// </summary>
    internal static string CallbackUrlFor(string? client, string configured)
    {
        if (!IsWebClient(client)
            || !Uri.TryCreate(configured, UriKind.Absolute, out var uri)
            || !uri.AbsolutePath.TrimEnd('/').EndsWith(ReturnPath, StringComparison.OrdinalIgnoreCase))
        {
            return configured;
        }

        return new UriBuilder(uri) { Path = uri.AbsolutePath.TrimEnd('/') + "/web" }.Uri.AbsoluteUri;
    }
}
