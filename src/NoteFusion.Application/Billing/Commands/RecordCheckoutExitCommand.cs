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
/// "What stopped you?": the client reports coming back from its checkout's payment page without paying, with how
/// long the page was open, and later the one-tap answer (<c>POST /api/billing/checkouts/{id}/exit</c>, the id being
/// the checkout's <c>reference</c> from the checkout response). The return is recorded the first time, the answer at
/// most once, and a paid checkout records nothing.
/// </summary>
/// <remarks>
/// The reply says whether to ask, and the sheet it opens says "No payment was made", so that is only said on the
/// provider's word: the first report of a return asks the provider about the checkout again, through the same
/// reconciliation as <c>confirm</c> (a payment found there is fulfilled as anywhere else, and nothing is recorded),
/// and asks only when the provider's page was read just now and shows nothing paid and no transfer under way (someone
/// who left the page to send a bank transfer is paying, not stopped). A provider that could not be read is no answer,
/// so nothing is asked. Asked once per checkout, so one reopened with "Try again" and left again is never asked
/// twice, on any device. The checkout's currency and amount ride along for the answer to "the price wasn't in my
/// currency".
/// </remarks>
/// <param name="CheckoutId">The checkout's reference, as the checkout response gave it.</param>
public sealed record RecordCheckoutExitCommand(
    string CheckoutId, int SecondsOpen, CheckoutExitReason? Reason = null, string? Note = null)
    : IRequest<Result<CheckoutExitDto>>;

public sealed class RecordCheckoutExitCommandValidator : AbstractValidator<RecordCheckoutExitCommand>
{
    public RecordCheckoutExitCommandValidator()
    {
        RuleFor(x => x.CheckoutId).NotEmpty().MaximumLength(100);
        RuleFor(x => x.SecondsOpen).InclusiveBetween(0, CheckoutExit.MaxSecondsOpen)
            .WithMessage("That doesn't look like how long the page was open.");
        RuleFor(x => x.Reason).IsInEnum();
        RuleFor(x => x.Note)
            .Must(n => n is null || n.Trim().Length <= CheckoutExit.NoteMaxLength)
            .WithMessage($"Please keep it to {CheckoutExit.NoteMaxLength} characters.");
    }
}

public sealed class RecordCheckoutExitCommandHandler : IRequestHandler<RecordCheckoutExitCommand, Result<CheckoutExitDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly BillingSettings _settings;

    public RecordCheckoutExitCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IPaymentGatewayFactory gateways,
        IDateTimeProvider clock,
        IEmailSender email,
        BillingSettings settings)
    {
        _db = db;
        _currentUser = currentUser;
        _gateways = gateways;
        _clock = clock;
        _email = email;
        _settings = settings;
    }

    public async Task<Result<CheckoutExitDto>> Handle(RecordCheckoutExitCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        // The caller's own checkout only: another account's reference reads as no checkout at all.
        var tx = await _db.PaymentTransactions
            .FirstOrDefaultAsync(t => t.Reference == request.CheckoutId && t.UserId == userId, ct);
        if (tx is null)
            return BillingErrors.CheckoutNotFound;

        var told = new CheckoutExitDto(false, tx.Currency, tx.AmountMinor, Math.Max(1, _settings.CheckoutReuseMinutes));
        if (IsPaid(tx))
            return told;

        var exit = await _db.CheckoutExits.FirstOrDefaultAsync(e => e.PaymentTransactionId == tx.Id, ct);

        // The first report of a return, and not yet an answer: ask the provider now, so the sheet only says no payment
        // was made when the provider's page has just said so.
        var pageRead = false;
        if (exit is null && request.Reason is null)
        {
            try
            {
                await ReconcilePaymentCommandHandler.ReconcileAsync(
                    _db, _gateways, _clock, _email, tx, ct,
                    check => pageRead = check.Attempt is not null || check.Verification.IsSuccess);
            }
            catch (DbUpdateException)
            {
                // The webhook fulfilled this payment as the reconciliation tried to: it was paid.
                return told;
            }

            if (IsPaid(tx))
                return told;
        }

        var now = _clock.UtcNow;
        var first = false;
        for (var attempt = 1; ; attempt++)
        {
            var isNew = exit is null;
            if (exit is null)
            {
                exit = CheckoutExit.Record(tx.Id, userId, request.SecondsOpen, now);
                _db.CheckoutExits.Add(exit);
            }

            var answered = request.Reason is { } reason && exit.Answer(reason, request.Note, now);
            if (!isNew && !answered)
                break;

            try
            {
                await _db.SaveChangesAsync(ct);
                first = isNew;
                break;
            }
            catch (DbUpdateException) when (isNew && attempt == 1)
            {
                // A second report of the same return landed a moment before this one (the unique checkout index).
                // Its row stands; the answer, if this one carries it, goes on that row.
                _db.CheckoutExits.Remove(exit);
                exit = await _db.CheckoutExits.FirstOrDefaultAsync(e => e.PaymentTransactionId == tx.Id, ct);
            }
        }

        // Asked once per checkout, on its first return, on the provider's fresh word, never while money is moving.
        var ask = first && pageRead && request.Reason is null && tx.ProviderAttempt != CheckoutAttempt.TransferStarted;
        return told with { Ask = ask };
    }

    private static bool IsPaid(PaymentTransaction tx) => tx.Status is PaymentStatus.Verified or PaymentStatus.Completed;
}
