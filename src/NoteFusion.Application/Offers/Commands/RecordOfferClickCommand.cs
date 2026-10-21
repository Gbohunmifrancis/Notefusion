using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Commands;

/// <summary>
/// <c>POST /api/offers/click</c>: the web app opened from an offer email's button (its <c>m=</c> token). Records the
/// first click on that email and nothing else; anonymous, and the same answer whatever the token, so it says nothing
/// about which tokens exist.
/// </summary>
public sealed record RecordOfferClickCommand(string? Token) : IRequest<Result>;

public sealed class RecordOfferClickCommandHandler : IRequestHandler<RecordOfferClickCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public RecordOfferClickCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result> Handle(RecordOfferClickCommand request, CancellationToken ct)
    {
        var token = request.Token?.Trim();
        if (string.IsNullOrEmpty(token) || token.Length < OfferTokens.MinLength || token.Length > OfferEmail.TokenMaxLength)
            return Result.Success();

        var now = _clock.UtcNow;
        // Once: a conditional update, so a second click (or a second tab) changes nothing.
        await _db.OfferEmails
            .Where(e => e.Token == token && e.ClickedAtUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.ClickedAtUtc, now), ct);
        return Result.Success();
    }
}
