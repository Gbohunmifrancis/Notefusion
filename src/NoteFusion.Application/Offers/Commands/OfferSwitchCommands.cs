using MediatR;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers.Commands;

/// <summary>
/// <c>PUT /api/admin/offers/{id}/enabled</c>: switches an offer on or off. On is refused for an offer over everywhere
/// (<c>OFFER_ENDED</c>) or whose window overlaps another enabled offer's (<c>OFFER_OVERLAPS</c>): one offer at a time.
/// Off takes it off the web app and the checkout at once and holds its email queue. Written to the audit log.
/// </summary>
public sealed record SetOfferEnabledCommand(Guid Id, bool Enabled) : IRequest<Result<AdminOfferDto>>;

public sealed class SetOfferEnabledCommandHandler : IRequestHandler<SetOfferEnabledCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public SetOfferEnabledCommandHandler(IApplicationDbContext db, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(SetOfferEnabledCommand request, CancellationToken ct)
    {
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        if (offer.Enabled != request.Enabled)
        {
            if (request.Enabled)
            {
                if (offer.HasEndedEverywhere(now))
                    return OfferErrors.Ended;
                if (await OfferAdmin.OverlapsAnotherAsync(_db, offer.Id, offer.StartsAtUtc, offer.LastDay, ct))
                    return OfferErrors.Overlaps;
            }

            offer.SetEnabled(request.Enabled, now);
            _audit.Record(AdminAuditAction.SetOfferEnabled, null,
                request.Enabled
                    ? $"Switched the {offer.Name} offer on: {OfferAdmin.Terms(offer)}."
                    : $"Switched the {offer.Name} offer off.");
            await _db.SaveChangesAsync(ct);
        }

        return OfferAdmin.Describe(offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), _settings, now);
    }
}

/// <summary>
/// <c>PUT /api/admin/offers/{id}/sending</c>: pauses or resumes an offer's email queue (nothing queued is lost; the
/// end still skips whoever it reaches first). <c>OFFER_NOT_SENT</c> before Send. Written to the audit log.
/// </summary>
public sealed record SetOfferSendingCommand(Guid Id, bool Paused) : IRequest<Result<AdminOfferDto>>;

public sealed class SetOfferSendingCommandHandler : IRequestHandler<SetOfferSendingCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public SetOfferSendingCommandHandler(IApplicationDbContext db, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(SetOfferSendingCommand request, CancellationToken ct)
    {
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;
        if (offer.SendStartedAtUtc is null)
            return OfferErrors.NotSent;

        var now = _clock.UtcNow;
        if (offer.SendPaused != request.Paused)
        {
            offer.SetSendPaused(request.Paused, now);
            _audit.Record(AdminAuditAction.SetOfferSending, null,
                request.Paused ? $"Paused sending the {offer.Name} offer email." : $"Resumed sending the {offer.Name} offer email.");
            await _db.SaveChangesAsync(ct);
        }

        return OfferAdmin.Describe(offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), _settings, now);
    }
}
