using FluentValidation;
using MediatR;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.GooglePlay;

/// <summary>
/// The Android app hands over a Google Play purchase it just made, or one it finds on restore. Only the token is
/// taken from the phone: what it bought, whether it is paid and until when are asked of Google
/// (<see cref="GooglePlaySync"/>). Returns the account's membership as it stands afterwards.
/// </summary>
public sealed record RegisterGooglePlayPurchaseCommand(string ProductId, string PurchaseToken)
    : IRequest<Result<SubscriptionDto>>;

public sealed class RegisterGooglePlayPurchaseCommandValidator : AbstractValidator<RegisterGooglePlayPurchaseCommand>
{
    public RegisterGooglePlayPurchaseCommandValidator()
    {
        RuleFor(x => x.ProductId)
            .Must(p => GooglePlaySync.IsSubscriptionProduct(p) || p == GooglePlaySync.SongProduct)
            .WithMessage("That isn't something NoteFusion sells.");
        RuleFor(x => x.PurchaseToken).NotEmpty().MaximumLength(GooglePlayPurchase.TokenMaxLength);
    }
}

public sealed class RegisterGooglePlayPurchaseCommandHandler
    : IRequestHandler<RegisterGooglePlayPurchaseCommand, Result<SubscriptionDto>>
{
    private readonly GooglePlaySync _sync;
    private readonly ICurrentUser _currentUser;
    private readonly ISender _sender;

    public RegisterGooglePlayPurchaseCommandHandler(GooglePlaySync sync, ICurrentUser currentUser, ISender sender)
    {
        _sync = sync;
        _currentUser = currentUser;
        _sender = sender;
    }

    public async Task<Result<SubscriptionDto>> Handle(RegisterGooglePlayPurchaseCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var synced = GooglePlaySync.IsSubscriptionProduct(request.ProductId)
            ? await _sync.SyncSubscriptionAsync(request.PurchaseToken, userId, ct)
            : await _sync.SyncOneTimeAsync(request.ProductId, request.PurchaseToken, userId, ct);
        if (synced.IsFailure)
            return synced.Error;

        return await _sender.Send(new GetMySubscriptionQuery(), ct);
    }
}
