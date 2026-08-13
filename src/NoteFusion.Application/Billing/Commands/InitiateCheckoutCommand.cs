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
/// double-charges.
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
        var reference = $"NF_{Guid.NewGuid():N}";
        var idempotencyKey = $"{userId:N}:{plan.Id:N}:{Guid.NewGuid():N}";

        var transaction = PaymentTransaction.Create(
            userId, plan.Id, gateway.Provider, idempotencyKey, reference, plan.AmountMinor, plan.Currency, now);

        // Persist PENDING before the provider is ever contacted (spec: durable audit row first).
        _db.PaymentTransactions.Add(transaction);
        await _db.SaveChangesAsync(ct);

        var initiation = await gateway.InitiateAsync(
            new GatewayInitiationRequest(
                reference, plan.AmountMinor, plan.Currency, user.Email,
                _settings.CheckoutCallbackUrl, Recurring: true, idempotencyKey),
            ct);

        if (initiation.IsFailure)
        {
            transaction.MarkFailed(initiation.Error.Message, _clock.UtcNow);
            await _db.SaveChangesAsync(ct);

            // The upgrade never started, so tell the user rather than leaving them watching a checkout
            // that will never open. Best-effort and post-commit: a mail failure must not turn a handled
            // decline into a 500 the client shows as "try again", risking a real second charge later.
            await _email.SendPaymentFailedAsync(new EmailRecipient(user.Email, user.FullName), plan.Name, ct);

            return BillingErrors.GatewayInitiationFailed(initiation.Error.Message);
        }

        transaction.AttachCheckout(
            initiation.Value.ProviderReference, initiation.Value.CheckoutUrl, initiation.Value.Raw, _clock.UtcNow);
        await _db.SaveChangesAsync(ct);

        return new CheckoutSessionDto(transaction.Reference, transaction.CheckoutUrl!, transaction.Provider);
    }
}
