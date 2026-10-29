using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Commands;

/// <summary>
/// <c>POST /api/admin/offers/{id}/send</c>: queues the offer's email for everyone in the ticked groups, as the audience
/// reads now (<see cref="OfferAudience"/>), one <see cref="OfferEmail"/> row each with its own click token, and locks
/// the words. The worker sends them in each person's sending hours as the quota allows. Refused without the postal
/// address (<c>OFFER_POSTAL_ADDRESS_MISSING</c>), while switched off (<c>OFFER_NOT_ENABLED</c>), once over everywhere
/// (<c>OFFER_ENDED</c>), a second time (<c>OFFER_ALREADY_SENT</c>), or for nobody (<c>OFFER_NO_AUDIENCE</c>). Written to
/// the audit log with the count.
/// </summary>
public sealed record SendOfferCommand(Guid Id, bool Free, bool Lapsed, bool ProNow) : IRequest<Result<AdminOfferDto>>;

public sealed class SendOfferCommandHandler : IRequestHandler<SendOfferCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public SendOfferCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _caller = caller;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(SendOfferCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        if (!_settings.PostalAddressSet)
            return OfferErrors.PostalAddressMissing;
        if (!offer.Enabled)
            return OfferErrors.NotEnabled;
        if (offer.HasEndedEverywhere(now))
            return OfferErrors.Ended;
        if (offer.SendStartedAtUtc is not null || await _db.OfferEmails.AnyAsync(e => e.OfferId == offer.Id, ct))
            return OfferErrors.AlreadySent;
        if (!request.Free && !request.Lapsed && !request.ProNow)
            return OfferErrors.NoAudience;

        var audience = (await OfferAudience.ReadAsync(_db, now, ct)).Chosen(request.Free, request.Lapsed, request.ProNow);
        if (audience.Count == 0)
            return OfferErrors.NoAudience;

        _db.OfferEmails.AddRange(audience.Select(m => OfferEmail.Queue(offer.Id, m.UserId, m.Group, OfferTokens.New(), now)));
        offer.StartSending(request.Free, request.Lapsed, request.ProNow, actorId, now);
        _audit.Record(AdminAuditAction.SendOffer, null,
            $"Sent the {offer.Name} offer email to {audience.Count.ToString("N0", CultureInfo.InvariantCulture)} "
            + $"{(audience.Count == 1 ? "person" : "people")} ({OfferAdmin.Groups(request.Free, request.Lapsed, request.ProNow)}).");

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique (offer, account) index: another admin's Send landed a moment before this one.
            return OfferErrors.AlreadySent;
        }

        return await OfferAdmin.DescribeAsync(_db, offer, _settings, now, ct);
    }
}

/// <summary>
/// <c>POST /api/admin/offers/{id}/last-call</c>: queues the offer's last call, the follow-up before it ends (its own
/// words, a live countdown, the usual price after it), for the groups the email went to, as the audience reads now
/// (so someone who joined since gets it too), less everyone who has already paid at the offer's price. Anyone whose
/// email is still queued gets the last call instead (<see cref="OfferSkipReason.LastCallInstead"/>): never both. The
/// words are locked from then. Refused before the email's Send (<c>OFFER_LAST_CALL_BEFORE_SEND</c>), a second time
/// (<c>OFFER_LAST_CALL_SENT</c>), and as Send is. Written to the audit log with the count.
/// </summary>
public sealed record SendOfferLastCallCommand(Guid Id, OfferWords? Words = null) : IRequest<Result<AdminOfferDto>>;

public sealed class SendOfferLastCallCommandHandler : IRequestHandler<SendOfferLastCallCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public SendOfferLastCallCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _caller = caller;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(SendOfferLastCallCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        if (!_settings.PostalAddressSet)
            return OfferErrors.PostalAddressMissing;
        if (!offer.Enabled)
            return OfferErrors.NotEnabled;
        if (offer.HasEndedEverywhere(now))
            return OfferErrors.Ended;
        if (offer.SendStartedAtUtc is null)
            return OfferErrors.LastCallBeforeSend;
        if (offer.LastCallStartedAtUtc is not null
            || await _db.OfferEmails.AnyAsync(e => e.OfferId == offer.Id && e.Round == OfferEmailRound.LastCall, ct))
            return OfferErrors.LastCallSent;
        var words = request.Words ?? OfferEmailComposer.LastCallWordsOf(offer);
        if (OfferAdmin.CheckWords(words) is { } invalid)
            return invalid;

        var bought = (await _db.PaymentTransactions
                .Where(t => t.OfferId == offer.Id && t.Status == PaymentStatus.Completed)
                .Select(t => t.UserId)
                .ToListAsync(ct))
            .ToHashSet();
        var audience = (await OfferAudience.ReadAsync(_db, now, ct))
            .Chosen(offer.SendIncludesFree, offer.SendIncludesLapsed, offer.SendIncludesProNow)
            .Where(m => !bought.Contains(m.UserId))
            .ToList();
        if (audience.Count == 0)
            return OfferErrors.NoAudience;

        // Whoever is still waiting for the email gets the last call instead.
        var waiting = await _db.OfferEmails
            .Where(e => e.OfferId == offer.Id && e.Round == OfferEmailRound.Launch && e.Status == OfferEmailStatus.Queued)
            .ToListAsync(ct);
        foreach (var row in waiting)
            row.Skip(OfferSkipReason.LastCallInstead);

        _db.OfferEmails.AddRange(audience.Select(m =>
            OfferEmail.Queue(offer.Id, m.UserId, m.Group, OfferTokens.New(), now, OfferEmailRound.LastCall)));
        offer.StartLastCall(words.Subject, words.Preheader, words.Headline, words.Body, actorId, now);
        _audit.Record(AdminAuditAction.SendOfferLastCall, null,
            $"Sent the {offer.Name} offer's last call to {audience.Count.ToString("N0", CultureInfo.InvariantCulture)} "
            + $"{(audience.Count == 1 ? "person" : "people")} ({OfferAdmin.Groups(offer.SendIncludesFree, offer.SendIncludesLapsed, offer.SendIncludesProNow)}).");

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique (offer, account, round) index: another admin's press landed a moment before this one.
            return OfferErrors.LastCallSent;
        }

        return await OfferAdmin.DescribeAsync(_db, offer, _settings, now, ct);
    }
}

/// <summary>
/// <c>POST /api/admin/offers/{id}/test</c>: the offer's email, as it would go to someone on <see cref="Set"/> prices,
/// sent to the signed-in admin's own address. It always goes (counted as one-case mail, not held by the quota), with
/// the postal-address placeholder until that is set. Written to the audit log.
/// </summary>
/// <param name="Set">"standard" (the default) or "regional".</param>
/// <param name="Round">"launch" (the default) or "lastCall".</param>
public sealed record SendOfferTestCommand(Guid Id, string? Set = null, string? Round = null) : IRequest<Result<OfferTestDto>>;

public sealed class SendOfferTestCommandHandler : IRequestHandler<SendOfferTestCommand, Result<OfferTestDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IEmailSender _email;
    private readonly IEmailUnsubscribeTokens _tokens;
    private readonly IAuditLogger _audit;
    private readonly OfferSettings _settings;

    public SendOfferTestCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IEmailSender email, IEmailUnsubscribeTokens tokens, IAuditLogger audit,
        OfferSettings settings)
    {
        _db = db;
        _caller = caller;
        _email = email;
        _tokens = tokens;
        _audit = audit;
        _settings = settings;
    }

    public async Task<Result<OfferTestDto>> Handle(SendOfferTestCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;
        if (OfferAdmin.ParseSet(request.Set) is not { } set)
            return OfferErrors.SetUnknown;
        if (OfferAdmin.ParseRound(request.Round) is not { } round)
            return OfferErrors.RoundUnknown;
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;
        var admin = await _db.Users.AsNoTracking()
            .Where(u => u.Id == actorId)
            .Select(u => new { u.Email, u.FullName })
            .FirstOrDefaultAsync(ct);
        if (admin is null)
            return AdminErrors.NotAuthenticated;

        var content = OfferEmailComposer.Compose(
            offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), set, token: null,
            OfferEmailComposer.UnsubscribeUrl(_settings, _tokens, actorId), _settings, round);
        var sent = await _email.SendOfferAsync(new EmailRecipient(admin.Email, admin.FullName), content, test: true, ct);
        if (sent.IsFailure)
            return OfferErrors.TestFailed;

        _audit.Record(AdminAuditAction.SendOfferTest, null,
            $"Sent a test of the {offer.Name} offer {(round == OfferEmailRound.LastCall ? "last call" : "email")} to {admin.Email} ({set} prices).");
        await _db.SaveChangesAsync(ct);
        return new OfferTestDto(admin.Email, set);
    }
}
