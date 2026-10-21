using System.Globalization;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Offers;

/// <summary>What the console's Offers page shares: how an offer is described, checked and named in the audit log.</summary>
public static class OfferAdmin
{
    public const string Draft = "draft";
    public const string Scheduled = "scheduled";
    public const string Running = "running";
    public const string Ended = "ended";

    /// <summary>"ended" once over everywhere; else "draft" while off; "scheduled" before it starts; "running".</summary>
    public static string StateOf(Offer offer, DateTime utcNow)
        => offer.HasEndedEverywhere(utcNow) ? Ended
            : !offer.Enabled ? Draft
            : utcNow < offer.StartsAtUtc ? Scheduled
            : Running;

    /// <summary>Running for real: switched on and past its start. Then only its last day may move, and only later.</summary>
    public static bool IsUnderway(Offer offer, DateTime utcNow) => offer.Enabled && offer.HasStarted(utcNow);

    /// <summary>The console's offer, with the plans it could price and whether its season is on now.</summary>
    public static async Task<AdminOfferDto> DescribeAsync(
        IApplicationDbContext db, Offer offer, OfferSettings settings, DateTime utcNow, CancellationToken ct)
        => Describe(
            offer, await OfferEmailComposer.OfferablePlansAsync(db, ct), settings, utcNow,
            await OfferSeason.IsOnAsync(db, offer, utcNow, ct));

    public static AdminOfferDto Describe(Offer offer, IReadOnlyList<Plan> plans, OfferSettings settings, DateTime utcNow, bool seasonOn)
        => new(
            offer.Id,
            offer.Key,
            offer.Name,
            offer.Template,
            offer.PercentOff,
            offer.IncludesMonthly,
            offer.IncludesYearly,
            offer.StartsAtUtc,
            offer.LastDay,
            offer.Enabled,
            StateOf(offer, utcNow),
            new OfferWords(offer.Subject, offer.Preheader, offer.Headline, offer.Body),
            offer.WordsLocked,
            plans
                .OrderBy(p => OfferPlans.SetOf(p) == OfferPlans.Standard ? 0 : 1)
                .ThenBy(p => p.Interval)
                .Select(p => new AdminOfferPlanDto(
                    p.Code, p.Interval.ToString(), OfferPlans.SetOf(p), p.AmountMinor, OfferPricing.Price(p.AmountMinor, offer.PercentOff)))
                .ToList(),
            offer.SendStartedAtUtc is { } started
                ? new AdminOfferSendDto(started, offer.SendPaused, offer.SendIncludesFree, offer.SendIncludesLapsed, offer.SendIncludesProNow)
                : null,
            settings.PostalAddressSet,
            offer.CreatedByEmail,
            offer.CreatedAtUtc,
            OfferTemplates.LabelOf(offer.Template),
            offer.EarliestEndUtc,
            offer.LatestEndUtc,
            seasonOn);

    /// <summary>The checks every create and update makes, in the order an admin would fix them; null when it is all right.</summary>
    public static Error? Check(
        string template, string name, int percentOff, bool monthly, bool yearly, DateTime startsAtUtc, DateOnly lastDay,
        OfferWords words, DateTime utcNow)
    {
        if (OfferTemplates.Find(template) is null)
            return OfferErrors.TemplateUnknown;
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > Offer.NameMaxLength)
            return OfferErrors.NameInvalid;
        if (percentOff is < Offer.MinPercentOff or > Offer.MaxPercentOff)
            return OfferErrors.PercentOutOfRange;
        if (!monthly && !yearly)
            return OfferErrors.NoPlans;

        // The last day ends first at UTC+14 (10:00 UTC that day) and last at UTC−12 (12:00 UTC the next day): it must
        // end after it starts everywhere, and not be over everywhere already.
        var firstEnd = DateTime.SpecifyKind(lastDay.ToDateTime(TimeOnly.MinValue).AddHours(10), DateTimeKind.Utc);
        var lastEnd = firstEnd.AddHours(26);
        if (AsUtc(startsAtUtc) >= firstEnd || lastEnd <= utcNow)
            return OfferErrors.DatesInvalid;

        return CheckWords(words);
    }

    public static Error? CheckWords(OfferWords words)
    {
        static Error? One(string? value, string what, int max)
            => string.IsNullOrWhiteSpace(value) ? OfferErrors.WordsInvalid($"The {what} cannot be empty.")
                : value.Trim().Length > max ? OfferErrors.WordsInvalid($"The {what} is at most {max} characters.")
                : null;

        return One(words.Subject, "subject", Offer.SubjectMaxLength)
               ?? One(words.Preheader, "preview line", Offer.PreheaderMaxLength)
               ?? One(words.Headline, "headline", Offer.HeadlineMaxLength)
               ?? One(words.Body, "body", Offer.BodyMaxLength);
    }

    /// <summary>
    /// Whether another enabled offer's window shares a moment, anywhere in the world, with one running from
    /// <paramref name="startsAtUtc"/> to the end of <paramref name="lastDay"/>.
    /// </summary>
    public static async Task<bool> OverlapsAnotherAsync(
        IApplicationDbContext db, Guid self, DateTime startsAtUtc, DateOnly lastDay, CancellationToken ct)
    {
        var others = await db.Offers.AsNoTracking().Where(o => o.Enabled && o.Id != self).ToListAsync(ct);
        return others.Any(o => Offer.WindowsOverlap(startsAtUtc, lastDay, o.StartsAtUtc, o.LastDay));
    }

    /// <summary>A time from a request as UTC: an offset is honoured, a bare time is read as UTC.</summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Local => value.ToUniversalTime(),
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        _ => value,
    };

    /// <summary>A key no other offer has: <c>halloween-2026</c>, else <c>halloween-2026-2</c> and on.</summary>
    public static async Task<string> FreeKeyAsync(IApplicationDbContext db, string template, DateTime startsAtUtc, Guid? self, CancellationToken ct)
    {
        var stem = OfferTemplates.KeyFor(template, startsAtUtc);
        var taken = (await db.Offers
                .Where(o => o.Id != self && o.Key.StartsWith(stem))
                .Select(o => o.Key)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        if (!taken.Contains(stem))
            return stem;
        for (var n = 2; ; n++)
        {
            var key = $"{stem}-{n}";
            if (!taken.Contains(key))
                return key;
        }
    }

    /// <summary>"30% off Pro Monthly and Yearly, Mon 26 Oct 2026 09:00 UK time to Sat 31 Oct 2026".</summary>
    public static string Terms(Offer offer)
    {
        var plans = (offer.IncludesMonthly, offer.IncludesYearly) switch
        {
            (true, true) => "Pro Monthly and Yearly",
            (true, false) => "Pro Monthly",
            _ => "Pro Yearly",
        };
        var start = TimeZoneInfo.ConvertTimeFromUtc(offer.StartsAtUtc, OfferWindow.DefaultZone);
        return $"{offer.PercentOff}% off {plans}, "
               + $"{start.ToString("ddd d MMM yyyy HH:mm", CultureInfo.InvariantCulture)} UK time "
               + $"to {offer.LastDay.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture)}";
    }

    /// <summary>"free accounts, lapsed Pro and Pro now".</summary>
    public static string Groups(bool free, bool lapsed, bool proNow)
    {
        var parts = new List<string>();
        if (free) parts.Add("free accounts");
        if (lapsed) parts.Add("lapsed Pro");
        if (proNow) parts.Add("Pro now");
        return parts.Count switch
        {
            0 => "nobody",
            1 => parts[0],
            _ => string.Join(", ", parts[..^1]) + " and " + parts[^1],
        };
    }

    /// <summary>The set a request names: "standard" (the default) or "regional"; null for anything else.</summary>
    public static string? ParseSet(string? set)
        => string.IsNullOrWhiteSpace(set) ? OfferPlans.Standard
            : string.Equals(set.Trim(), OfferPlans.Standard, StringComparison.OrdinalIgnoreCase) ? OfferPlans.Standard
            : string.Equals(set.Trim(), OfferPlans.Regional, StringComparison.OrdinalIgnoreCase) ? OfferPlans.Regional
            : null;

    public static Task<Offer?> FindAsync(IApplicationDbContext db, Guid id, CancellationToken ct)
        => db.Offers.FirstOrDefaultAsync(o => o.Id == id, ct);
}
