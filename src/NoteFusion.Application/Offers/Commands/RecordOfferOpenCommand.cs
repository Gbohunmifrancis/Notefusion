using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Commands;

/// <summary>
/// <c>GET /api/offers/o/{token}</c>: an offer email's 1×1 image was loaded. Records the first open of that email and
/// nothing else; anonymous, and the same image whatever the token, so it says nothing about which tokens exist.
/// </summary>
public sealed record RecordOfferOpenCommand(string? Token) : IRequest<Result>;

public sealed class RecordOfferOpenCommandHandler : IRequestHandler<RecordOfferOpenCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public RecordOfferOpenCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result> Handle(RecordOfferOpenCommand request, CancellationToken ct)
    {
        var token = request.Token?.Trim();
        if (string.IsNullOrEmpty(token) || token.Length < OfferTokens.MinLength || token.Length > OfferEmail.TokenMaxLength)
            return Result.Success();

        var now = _clock.UtcNow;
        // Once: a conditional update, so a mail app loading the image again changes nothing.
        await _db.OfferEmails
            .Where(e => e.Token == token && e.OpenedAtUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.OpenedAtUtc, now), ct);
        return Result.Success();
    }
}
