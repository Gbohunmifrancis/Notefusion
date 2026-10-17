using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Push.Commands;

/// <summary>The two keys of a browser's <c>PushSubscription.toJSON()</c>.</summary>
public sealed record WebPushSubscriptionKeysDto(string P256dh, string Auth);

/// <summary>
/// Saves this browser's push subscription for the signed-in account (the body is the browser's own
/// <c>subscription.toJSON()</c>; <c>expirationTime</c> is ignored). <paramref name="UserAgent"/> is set by
/// the controller from the request, never read from the body.
/// </summary>
public sealed record SaveWebPushSubscriptionCommand(string Endpoint, WebPushSubscriptionKeysDto? Keys, string? UserAgent = null)
    : IRequest<Result>;

public sealed class SaveWebPushSubscriptionCommandValidator : AbstractValidator<SaveWebPushSubscriptionCommand>
{
    public SaveWebPushSubscriptionCommandValidator()
    {
        RuleFor(x => x.Endpoint).NotEmpty().MaximumLength(WebPushSubscription.EndpointMaxLength);
        RuleFor(x => x.Keys).NotNull();
        // An uncompressed P-256 point (65 bytes, 0x04 first) and a 16-byte secret, as RFC 8291 requires.
        RuleFor(x => x.Keys!.P256dh).Must(k => WebPush.IsKey(k, 65, 0x04)).When(x => x.Keys is not null)
            .WithMessage("The subscription's p256dh key is not a P-256 public key.");
        RuleFor(x => x.Keys!.Auth).Must(k => WebPush.IsKey(k, 16)).When(x => x.Keys is not null)
            .WithMessage("The subscription's auth secret is not 16 bytes.");
    }
}

public sealed class SaveWebPushSubscriptionCommandHandler : IRequestHandler<SaveWebPushSubscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly ICurrentUser _currentUser;
    private readonly IWebPushKeys _keys;

    public SaveWebPushSubscriptionCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, ICurrentUser currentUser, IWebPushKeys keys)
    {
        _db = db;
        _clock = clock;
        _currentUser = currentUser;
        _keys = keys;
    }

    public async Task<Result> Handle(SaveWebPushSubscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (_keys.PublicKey is null)
            return WebPush.Off;
        if (!WebPush.IsAllowedEndpoint(request.Endpoint))
            return WebPush.EndpointNotAllowed;
        if (!await _db.Users.AnyAsync(u => u.Id == userId, ct))
            return UserErrors.NotFound;

        var now = _clock.UtcNow;
        var p256dh = request.Keys!.P256dh.Trim().TrimEnd('=');
        var auth = request.Keys.Auth.Trim().TrimEnd('=');

        // The endpoint names a browser profile, not a person: one that signs into another account sends that
        // account's notifications from now on, never the previous one's (as RegisterDevice does for phones).
        var existing = await _db.WebPushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == request.Endpoint, ct);
        if (existing is null)
            _db.WebPushSubscriptions.Add(WebPushSubscription.Create(userId, request.Endpoint, p256dh, auth, request.UserAgent, now));
        else
            existing.Refresh(userId, p256dh, auth, request.UserAgent, now);

        // Bounded per account: each browser that ever said yes is a row, and a send goes to all of them.
        var stale = await _db.WebPushSubscriptions
            .Where(s => s.UserId == userId && s.Endpoint != request.Endpoint)
            .OrderByDescending(s => s.UpdatedAtUtc)
            .Skip(WebPush.MaxSubscriptionsPerUser - 1)
            .ToListAsync(ct);
        _db.WebPushSubscriptions.RemoveRange(stale);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>Forgets this browser's subscription for the signed-in account (notifications off, or signing out).</summary>
public sealed record DeleteWebPushSubscriptionCommand(string Endpoint) : IRequest<Result>;

public sealed class DeleteWebPushSubscriptionCommandValidator : AbstractValidator<DeleteWebPushSubscriptionCommand>
{
    public DeleteWebPushSubscriptionCommandValidator()
    {
        RuleFor(x => x.Endpoint).NotEmpty().MaximumLength(WebPushSubscription.EndpointMaxLength);
    }
}

public sealed class DeleteWebPushSubscriptionCommandHandler : IRequestHandler<DeleteWebPushSubscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public DeleteWebPushSubscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(DeleteWebPushSubscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        // Only the caller's own row: an old session signing out must not take a browser away from the account
        // signed in on it now. Idempotent: nothing to remove is still "we will not send there".
        var row = await _db.WebPushSubscriptions
            .FirstOrDefaultAsync(s => s.Endpoint == request.Endpoint && s.UserId == userId, ct);
        if (row is not null)
        {
            _db.WebPushSubscriptions.Remove(row);
            await _db.SaveChangesAsync(ct);
        }
        return Result.Success();
    }
}
