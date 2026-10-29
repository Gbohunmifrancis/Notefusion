using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Commands;

/// <summary>
/// <c>POST /api/admin/offers/{id}/push</c>: sends one of the offer's emails (<c>round</c>: "launch" or "lastCall") as a
/// notification too, to the same groups as the audience reads now, less anyone who has bought, and only to those with
/// somewhere to show it: a browser that turned the web app's notifications on, or, with <c>phones</c>, a phone with
/// the app's. A notification is not mail, so the email quota never holds it; it still goes in each person's sending
/// hours. Its words are the email's subject and preview line. Once per round, after that round's email.
/// </summary>
/// <remarks>
/// Phones are off unless asked: the offer's price is on the website, and Google Play does not let an app send its users
/// to pay outside Play. A phone's notification opens the app's own Upgrade screen, never the website.
/// </remarks>
public sealed record SendOfferPushCommand(Guid Id, string? Round = null, bool Phones = false) : IRequest<Result<OfferPushSentDto>>;

public sealed class SendOfferPushCommandHandler : IRequestHandler<SendOfferPushCommand, Result<OfferPushSentDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public SendOfferPushCommandHandler(IApplicationDbContext db, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result<OfferPushSentDto>> Handle(SendOfferPushCommand request, CancellationToken ct)
    {
        if (OfferAdmin.ParseRound(request.Round) is not { } round)
            return OfferErrors.RoundUnknown;
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        if (!offer.Enabled)
            return OfferErrors.NotEnabled;
        if (offer.HasEndedEverywhere(now))
            return OfferErrors.Ended;
        var sent = round == OfferEmailRound.LastCall ? offer.LastCallStartedAtUtc : offer.SendStartedAtUtc;
        if (sent is null)
            return OfferErrors.PushBeforeEmail;
        if (await _db.OfferEmails.AnyAsync(e => e.OfferId == offer.Id && e.Round == round && e.Channel != OfferChannel.Email, ct))
            return OfferErrors.PushSent;

        var bought = (await _db.PaymentTransactions
                .Where(t => t.OfferId == offer.Id && t.Status == PaymentStatus.Completed)
                .Select(t => t.UserId)
                .ToListAsync(ct))
            .ToHashSet();
        var browsers = (await _db.WebPushSubscriptions
                .Where(s => s.Audience == WebPushSubscription.AppAudience)
                .Select(s => s.UserId)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet();
        var phones = request.Phones
            ? (await _db.DeviceTokens
                    .Where(d => d.Platform == "android" || d.Platform == "ios")
                    .Select(d => d.UserId)
                    .Distinct()
                    .ToListAsync(ct))
                .ToHashSet()
            : [];

        var audience = (await OfferAudience.ReadAsync(_db, now, ct))
            .Chosen(offer.SendIncludesFree, offer.SendIncludesLapsed, offer.SendIncludesProNow)
            .Where(m => !bought.Contains(m.UserId) && (browsers.Contains(m.UserId) || phones.Contains(m.UserId)))
            .ToList();
        if (audience.Count == 0)
            return OfferErrors.NoPushAudience;

        var channel = request.Phones ? OfferChannel.PhoneAndWebPush : OfferChannel.WebPush;
        _db.OfferEmails.AddRange(audience.Select(m => OfferEmail.Queue(offer.Id, m.UserId, m.Group, OfferTokens.New(), now, round, channel)));
        var which = round == OfferEmailRound.LastCall ? "last call" : "email";
        _audit.Record(AdminAuditAction.SendOfferPush, null,
            $"Sent the {offer.Name} offer's {which} as a notification to {audience.Count.ToString("N0", CultureInfo.InvariantCulture)} "
            + $"{(audience.Count == 1 ? "person" : "people")} ({(request.Phones ? "web app and phones" : "web app")}).");

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique (offer, account, round, channel) index: another admin's press landed a moment before this one.
            return OfferErrors.PushSent;
        }

        return new OfferPushSentDto(OfferAdmin.RoundName(round), audience.Count, request.Phones);
    }
}
