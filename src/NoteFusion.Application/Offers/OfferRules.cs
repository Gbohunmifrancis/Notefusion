using System.Security.Cryptography;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Flags;
using NoteFusion.Application.Practice;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Offers;

/// <summary>
/// An offer's price: the plan's own price less the percent, rounded down, so every price is at least that much off.
/// A plan priced in whole dollars stays whole ($79 at 30% is $55, not $55.30).
/// </summary>
public static class OfferPricing
{
    /// <summary>
    /// <c>floor(amountMinor × (100 − pct) / 100)</c>, then down to whole dollars when the plan's own price is whole.
    /// $9.99 → $6.99, $79 → $55, $4.99 → $3.49, $39.99 → $27.99 at 30%. Never below one minor unit.
    /// </summary>
    public static long Price(long amountMinor, int pct)
    {
        if (amountMinor <= 0)
            throw new ArgumentOutOfRangeException(nameof(amountMinor), amountMinor, "A price is positive.");
        if (pct is < 0 or >= 100)
            throw new ArgumentOutOfRangeException(nameof(pct), pct, "Percent off is 0 to 99.");

        var price = amountMinor * (100 - pct) / 100;
        if (amountMinor % 100 == 0)
            price = price / 100 * 100;
        return Math.Max(1, price);
    }
}

/// <summary>
/// When an offer ends for one person: midnight at the end of its last day in their own time zone (DST-safe), the
/// account's zone or the request's <c>X-Time-Zone</c>, and the UK's when neither is known.
/// </summary>
public static class OfferWindow
{
    public const string DefaultZoneId = "Europe/London";

    /// <summary>Europe/London, or plain GMT where the host has no time zone database.</summary>
    public static readonly TimeZoneInfo DefaultZone =
        TimeZoneInfo.TryFindSystemTimeZoneById(DefaultZoneId, out var london)
            ? london
            : TimeZoneInfo.CreateCustomTimeZone(DefaultZoneId, TimeSpan.Zero, "United Kingdom", "GMT");

    /// <summary>
    /// The zone <paramref name="value"/> names (an IANA name or an offset, as <see cref="PracticeTime"/> reads them), or
    /// <see cref="DefaultZone"/> when it names nothing this host knows.
    /// </summary>
    public static TimeZoneInfo Resolve(string? value)
        => PracticeTime.Known(value) is { } known ? PracticeTime.Resolve(known) : DefaultZone;

    /// <summary>The account's own zone when it has one, else the request's, else the UK's.</summary>
    public static TimeZoneInfo Resolve(string? accountZone, string? requestZone)
        => Resolve(PracticeTime.Known(accountZone) ?? requestZone);

    /// <summary>
    /// The midnight after <see cref="Offer.LastDay"/> in <paramref name="zone"/>, as an instant; never later than that
    /// midnight at UTC−12 (<see cref="Offer.LatestEndUtc"/>), whatever offset a client claims.
    /// </summary>
    public static DateTime EndsAtUtc(Offer offer, TimeZoneInfo zone)
    {
        var end = PracticeTime.NextMidnightUtc(offer.LastDay, zone);
        return end < offer.LatestEndUtc ? end : offer.LatestEndUtc;
    }

    /// <inheritdoc cref="EndsAtUtc(Offer, TimeZoneInfo)"/>
    public static DateTime EndsAtUtc(Offer offer, string? timeZone) => EndsAtUtc(offer, Resolve(timeZone));

    /// <summary>
    /// On, started, and not yet past its end where the person is. Never past its end at UTC−12, the last place a day
    /// ends: a zone is the client's word, and an offset of −14:00 must not buy two more hours.
    /// </summary>
    public static bool IsLiveFor(Offer offer, TimeZoneInfo zone, DateTime utcNow)
        => offer.Enabled && utcNow >= offer.StartsAtUtc && utcNow < EndsAtUtc(offer, zone) && utcNow < offer.LatestEndUtc;

    /// <summary>
    /// Started, and over for this person: past their end, or switched off after it started ("The Halloween offer has
    /// ended.").
    /// </summary>
    public static bool HasEndedFor(Offer offer, TimeZoneInfo zone, DateTime utcNow)
        => utcNow >= offer.StartsAtUtc && !IsLiveFor(offer, zone, utcNow);

    /// <summary>The calendar day <paramref name="utc"/> falls on in the UK: the day the console's progress counts by.</summary>
    public static DateOnly UkDate(DateTime utc) => PracticeTime.LocalDate(utc, DefaultZone);
}


/// <summary>
/// An offer belongs to its season: the Halloween offer shows only while the Halloween season is on for everyone (Feature
/// flags), the Christmas one with Christmas. Switching the season off takes the offer's banner, prices, checkout price and
/// emails with it, as switching the offer itself off does; switching it back on brings them back while the offer runs.
/// </summary>
public static class OfferSeason
{
    public static Task<bool> IsOnAsync(IApplicationDbContext db, Offer offer, DateTime utcNow, CancellationToken ct)
        => FeatureFlags.IsOnForEveryoneAsync(db, utcNow, offer.Template, ct);
}
/// <summary>Which plans an offer lowers: Pro Monthly and Pro Yearly in dollars (standard and regional), never naira, choir or one song.</summary>
public static class OfferPlans
{
    public const string Standard = "standard";
    public const string Regional = "regional";
    private const string Dollars = "USD";

    /// <summary>A plan an offer could include: on sale, Pro (not choir), monthly or yearly, in dollars.</summary>
    public static bool IsOfferable(Plan plan)
        => plan.IsActive
           && !plan.IsChoir
           && plan.Interval is BillingInterval.Monthly or BillingInterval.Yearly
           && string.Equals(plan.Currency, Dollars, StringComparison.OrdinalIgnoreCase);

    /// <summary>A plan this offer lowers.</summary>
    public static bool Includes(Offer offer, Plan plan)
        => IsOfferable(plan)
           && (plan.Interval == BillingInterval.Monthly ? offer.IncludesMonthly : offer.IncludesYearly);

    /// <summary>"standard" or "regional": which dollar set a plan belongs to.</summary>
    public static string SetOf(Plan plan)
        => PlanEligibility.TierOf(plan.Code, plan.Currency) == PlanEligibility.Tier.RegionalDollar ? Regional : Standard;

    /// <summary>The set an account in <paramref name="country"/> buys from, or null for naira (Nigeria).</summary>
    public static string? SetFor(string? country)
        => string.IsNullOrWhiteSpace(country)
            ? Standard
            : PlanEligibility.TierFor(country) switch
            {
                PlanEligibility.Tier.Naira => null,
                PlanEligibility.Tier.RegionalDollar => Regional,
                _ => Standard,
            };

    /// <summary>"Pro Monthly" / "Pro Yearly", as the email's price box names them.</summary>
    public static string ShortName(BillingInterval interval) => interval == BillingInterval.Yearly ? "Pro Yearly" : "Pro Monthly";
}

/// <summary>The click token in an offer email's button: 16 random bytes, base64url (22 characters).</summary>
public static class OfferTokens
{
    public const int MinLength = 22;

    public static string New()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
