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
/// <c>POST /api/admin/offers</c>: a new offer, switched off (a draft). What is left out comes from the template: its
/// next last day and start, 30%, both plans, the words. The key is the template and the start's year
/// (<c>halloween-2026</c>). Written to the audit log.
/// </summary>
public sealed record CreateOfferCommand(
    string Template,
    string? Name = null,
    int? PercentOff = null,
    bool? IncludesMonthly = null,
    bool? IncludesYearly = null,
    DateTime? StartsAtUtc = null,
    DateOnly? LastDay = null,
    OfferWords? Words = null) : IRequest<Result<AdminOfferDto>>;

public sealed class CreateOfferCommandHandler : IRequestHandler<CreateOfferCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public CreateOfferCommandHandler(
        IApplicationDbContext db, ICurrentUser caller, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _caller = caller;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(CreateOfferCommand request, CancellationToken ct)
    {
        if (_caller.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;
        if (OfferTemplates.Find(request.Template) is not { } template)
            return OfferErrors.TemplateUnknown;

        var now = _clock.UtcNow;
        var lastDay = request.LastDay ?? template.NextLastDay(now);
        var startsAt = request.StartsAtUtc is { } given ? OfferAdmin.AsUtc(given) : template.StartsAtUtcFor(lastDay);
        var name = string.IsNullOrWhiteSpace(request.Name) ? template.NameFor(lastDay) : request.Name.Trim();
        var percent = request.PercentOff ?? OfferTemplates.DefaultPercentOff;
        var monthly = request.IncludesMonthly ?? true;
        var yearly = request.IncludesYearly ?? true;
        var words = request.Words ?? template.Words;

        if (OfferAdmin.Check(template.Template, name, percent, monthly, yearly, startsAt, lastDay, words, now) is { } refused)
            return refused;

        var offer = Offer.Create(
            await OfferAdmin.FreeKeyAsync(_db, template.Template, startsAt, null, ct),
            name, template.Template, percent, monthly, yearly, startsAt, lastDay,
            words.Subject, words.Preheader, words.Headline, words.Body,
            actorId, _caller.Email, now);
        _db.Offers.Add(offer);
        _audit.Record(AdminAuditAction.CreateOffer, null, $"Created the {offer.Name} offer: {OfferAdmin.Terms(offer)}.");

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique key: another admin created the same season's offer a moment before.
            return OfferErrors.Conflict;
        }

        return OfferAdmin.Describe(offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), _settings, now);
    }
}

/// <summary>
/// <c>PUT /api/admin/offers/{id}</c>: the same fields as create (what is left out stays). Until it is underway (on and
/// past its start) everything may change; after, only the last day, and only later (<c>OFFER_STARTED</c>). The words
/// are refused once the email has been sent (<c>OFFER_WORDS_LOCKED</c>) unless they are unchanged. An enabled offer's
/// new dates must not overlap another enabled one (<c>OFFER_OVERLAPS</c>). Written to the audit log when anything changed.
/// </summary>
public sealed record UpdateOfferCommand(
    Guid Id,
    string? Template = null,
    string? Name = null,
    int? PercentOff = null,
    bool? IncludesMonthly = null,
    bool? IncludesYearly = null,
    DateTime? StartsAtUtc = null,
    DateOnly? LastDay = null,
    OfferWords? Words = null) : IRequest<Result<AdminOfferDto>>;

public sealed class UpdateOfferCommandHandler : IRequestHandler<UpdateOfferCommand, Result<AdminOfferDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly OfferSettings _settings;

    public UpdateOfferCommandHandler(IApplicationDbContext db, IAuditLogger audit, IDateTimeProvider clock, OfferSettings settings)
    {
        _db = db;
        _audit = audit;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminOfferDto>> Handle(UpdateOfferCommand request, CancellationToken ct)
    {
        if (await OfferAdmin.FindAsync(_db, request.Id, ct) is not { } offer)
            return OfferErrors.NotFound;

        var now = _clock.UtcNow;
        var template = request.Template?.Trim().ToLowerInvariant() ?? offer.Template;
        var name = request.Name?.Trim() ?? offer.Name;
        var percent = request.PercentOff ?? offer.PercentOff;
        var monthly = request.IncludesMonthly ?? offer.IncludesMonthly;
        var yearly = request.IncludesYearly ?? offer.IncludesYearly;
        var startsAt = request.StartsAtUtc is { } s ? OfferAdmin.AsUtc(s) : offer.StartsAtUtc;
        var lastDay = request.LastDay ?? offer.LastDay;
        var current = new OfferWords(offer.Subject, offer.Preheader, offer.Headline, offer.Body);
        var words = request.Words is { } w ? Trimmed(w) : current;

        var termsChanged = template != offer.Template || percent != offer.PercentOff || monthly != offer.IncludesMonthly
                           || yearly != offer.IncludesYearly || startsAt != offer.StartsAtUtc;
        if (OfferAdmin.IsUnderway(offer, now) && (termsChanged || lastDay < offer.LastDay))
            return OfferErrors.Started;
        var wordsChanged = words != current;
        if (wordsChanged && offer.WordsLocked)
            return OfferErrors.WordsLocked;

        if (OfferAdmin.Check(template, name, percent, monthly, yearly, startsAt, lastDay, words, now) is { } refused)
            return refused;

        var before = OfferAdmin.Terms(offer);
        var beforeName = offer.Name;
        var datesChanged = startsAt != offer.StartsAtUtc || lastDay != offer.LastDay;
        if (!termsChanged && !wordsChanged && name == offer.Name && lastDay == offer.LastDay)
            return OfferAdmin.Describe(offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), _settings, now);

        if (offer.Enabled && datesChanged && await OfferAdmin.OverlapsAnotherAsync(_db, offer.Id, startsAt, lastDay, ct))
            return OfferErrors.Overlaps;

        offer.SetTerms(name, template, percent, monthly, yearly, startsAt, lastDay, now);
        if (wordsChanged)
            offer.SetWords(words.Subject, words.Preheader, words.Headline, words.Body, now);

        // The key names the season and the year; it follows them until an email has gone out carrying it.
        if (!offer.WordsLocked && !OfferAdmin.IsUnderway(offer, now)
            && OfferTemplates.KeyFor(offer.Template, offer.StartsAtUtc) is var stem && !offer.Key.StartsWith(stem, StringComparison.Ordinal))
        {
            offer.Rekey(await OfferAdmin.FreeKeyAsync(_db, offer.Template, offer.StartsAtUtc, offer.Id, ct), now);
        }

        var parts = new List<string>();
        if (offer.Name != beforeName) parts.Add($"renamed it from {beforeName}");
        if (OfferAdmin.Terms(offer) != before) parts.Add($"now {OfferAdmin.Terms(offer)} (was {before})");
        if (wordsChanged) parts.Add("changed the email's words");
        _audit.Record(AdminAuditAction.UpdateOffer, null, $"Changed the {offer.Name} offer: {string.Join("; ", parts)}.");

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return OfferErrors.Conflict;
        }

        return OfferAdmin.Describe(offer, await OfferEmailComposer.OfferablePlansAsync(_db, ct), _settings, now);
    }

    private static OfferWords Trimmed(OfferWords w)
        => new(w.Subject?.Trim() ?? string.Empty, w.Preheader?.Trim() ?? string.Empty, w.Headline?.Trim() ?? string.Empty,
            w.Body?.Trim() ?? string.Empty);
}
