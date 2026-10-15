using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Outreach.Commands;

/// <summary>
/// The one-click unsubscribe link in an outreach email: no sign-in, the signed token is the credential.
/// Records an <see cref="EmailOptOut"/>, which every outreach send checks. Idempotent: a second click, a
/// mail client's own one-click POST, or a link for an account since deleted all succeed quietly.
/// </summary>
public sealed record UnsubscribeEmailCommand(string? Token) : IRequest<Result>;

public static class OutreachErrors
{
    public static readonly Error InvalidUnsubscribeLink = Error.Validation(
        "EMAIL_UNSUBSCRIBE_INVALID",
        "This unsubscribe link isn't valid. Reply to any of our emails and we'll take you off the list.");
}

public sealed class UnsubscribeEmailCommandHandler : IRequestHandler<UnsubscribeEmailCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailUnsubscribeTokens _tokens;

    public UnsubscribeEmailCommandHandler(IApplicationDbContext db, IDateTimeProvider clock, IEmailUnsubscribeTokens tokens)
    {
        _db = db;
        _clock = clock;
        _tokens = tokens;
    }

    public async Task<Result> Handle(UnsubscribeEmailCommand request, CancellationToken ct)
    {
        if (_tokens.Read(request.Token) is not { } userId)
            return OutreachErrors.InvalidUnsubscribeLink;

        if (!await _db.Users.AnyAsync(u => u.Id == userId, ct)
            || await _db.EmailOptOuts.AnyAsync(o => o.UserId == userId, ct))
            return Result.Success();

        var optOut = EmailOptOut.Create(userId, _clock.UtcNow);
        _db.EmailOptOuts.Add(optOut);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two clicks at once: the other one recorded it.
            _db.EmailOptOuts.Remove(optOut);
        }

        return Result.Success();
    }
}
