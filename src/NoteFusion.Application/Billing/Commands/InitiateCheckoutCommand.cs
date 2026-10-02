using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
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
public sealed record InitiateCheckoutCommand(Guid PlanId) : IRequest<Result<CheckoutSessionDto>>;

public sealed class InitiateCheckoutCommandValidator : AbstractValidator<InitiateCheckoutCommand>
{
    public InitiateCheckoutCommandValidator() => RuleFor(x => x.PlanId).NotEmpty();
}

public sealed class InitiateCheckoutCommandHandler : IRequestHandler<InitiateCheckoutCommand, Result<CheckoutSessionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;
    private readonly IEmailSender _email;

    public InitiateCheckoutCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IPaymentGatewayFactory gateways,
        IDateTimeProvider clock,
        BillingSettings settings,
        IEmailSender email)
    {
        _db = db;
        _currentUser = currentUser;
        _gateways = gateways;
        _clock = clock;
        _settings = settings;
        _email = email;
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
        if (!PlanEligibility.IsOffered(plan.Currency, user.Country))
            return BillingErrors.PlanNotAvailableInRegion;

        // Nothing bills off-session, so a member buying again is how Pro continues: the payment adds a
        // period after the one already paid for (PaymentFulfillment stacks it), on whichever plan they
        // chose. Only lifetime access has nothing left to buy. Ordered as GetMySubscriptionQuery orders
        // it, so this is the membership the app is showing.
        var current = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (current is not null && current.IsLifetime && current.IsActiveAt(_clock.UtcNow))
            return BillingErrors.AlreadyLifetime;

        // Retry-safe: an existing in-flight checkout for this user+plan is reused, so tapping "Upgrade"
        // twice returns the same session instead of opening a second charge.
        var inFlight = await _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.PlanId == plan.Id
                        && t.Status == PaymentStatus.Processing
                        && t.CheckoutUrl != null)
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
        if (inFlight is not null)
            return new CheckoutSessionDto(inFlight.Reference, inFlight.CheckoutUrl!, inFlight.Provider);

        var gatewayResult = _gateways.SelectForCurrency(plan.Currency);
        if (gatewayResult.IsFailure)
            return gatewayResult.Error;
        var gateway = gatewayResult.Value;

        var now = _clock.UtcNow;

        // A row still Pending means a previous attempt persisted its audit trail but never got a checkout
        // URL back — the provider timed out, the process died, or the network dropped the response. Reusing
        // that row (and therefore its reference and idempotency key) is what makes the retry safe: the
        // provider recognises the replayed key and returns the ORIGINAL session, so a user who was already
        // debited on the invisible first attempt is not charged again. Minting a fresh key here instead
        // would make every retry a brand-new charge, which is exactly the duplicate we must never create.
        // Narrowed on provider/amount/currency so a re-priced plan or a re-routed provider starts clean
        // rather than replaying a key the provider fingerprinted against a different body.
        var transaction = await _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.PlanId == plan.Id
                        && t.Status == PaymentStatus.Pending
                        && t.Provider == gateway.Provider
                        && t.AmountMinor == plan.AmountMinor
                        && t.Currency == plan.Currency)
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);

        if (transaction is null)
        {
            var reference = $"NF_{Guid.NewGuid():N}";

            // Derived from the reference, not from a fresh Guid: the key must be stable across retries of
            // THIS initiation, and the reference already identifies it uniquely.
            transaction = PaymentTransaction.Create(
                userId, plan.Id, gateway.Provider, $"checkout:{reference}", reference,
                plan.AmountMinor, plan.Currency, now);

            // Persist PENDING before the provider is ever contacted (spec: durable audit row first).
            _db.PaymentTransactions.Add(transaction);
            await _db.SaveChangesAsync(ct);
        }

        var initiation = await gateway.InitiateAsync(
            new GatewayInitiationRequest(
                transaction.Reference, plan.AmountMinor, plan.Currency, user.Email,
                _settings.CheckoutCallbackUrl,
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
}
