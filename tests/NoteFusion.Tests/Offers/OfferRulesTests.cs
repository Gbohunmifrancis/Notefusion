using NoteFusion.Application.Offers;
using NoteFusion.Core.Entities;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// The offer's arithmetic: the price rounded down (whole dollars stay whole), the end at each person's own midnight
/// (DST included, the UK's when unknown), the world-wide window the overlap rule reads, and the templates' defaults.
/// </summary>
public class OfferRulesTests
{
    // ── Price ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(999, 30, 699)]     // $9.99 → $6.99
    [InlineData(7_900, 30, 5_500)] // $79 → $55 (not $55.30: a whole price stays whole)
    [InlineData(499, 30, 349)]     // $4.99 → $3.49
    [InlineData(3_999, 30, 2_799)] // $39.99 → $27.99
    public void The_board_prices_are_the_plan_price_less_the_percent_rounded_down(long amount, int pct, long expected)
        => Assert.Equal(expected, OfferPricing.Price(amount, pct));

    [Theory]
    [InlineData(7_900, 25, 5_900)]  // 59.25 → $59
    [InlineData(1_000, 33, 600)]    // 6.70 → $6
    [InlineData(999, 25, 749)]      // 7.4925 → $7.49: a price with cents keeps its cents
    [InlineData(999, 5, 949)]
    public void A_whole_dollar_plan_is_floored_to_whole_dollars_and_others_to_the_cent(long amount, int pct, long expected)
        => Assert.Equal(expected, OfferPricing.Price(amount, pct));

    [Fact]
    public void Every_offer_price_is_at_least_the_percent_off()
    {
        foreach (var amount in new long[] { 99, 199, 499, 999, 1_999, 3_999, 7_900, 19_900 })
            for (var pct = Offer.MinPercentOff; pct <= Offer.MaxPercentOff; pct++)
                Assert.True(OfferPricing.Price(amount, pct) * 100 <= amount * (100 - pct), $"{amount} at {pct}%");
    }

    // ── When it ends ─────────────────────────────────────────────────────────

    [Fact]
    public void In_London_it_ends_at_midnight_GMT_because_summer_time_ended_on_25_October()
    {
        var offer = Halloween();
        Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc), OfferWindow.EndsAtUtc(offer, "Europe/London"));

        // A last day still in summer time ends an hour earlier in UTC.
        var summer = Halloween(lastDay: new DateOnly(2026, 10, 20), start: new DateTime(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc));
        Assert.Equal(new DateTime(2026, 10, 20, 23, 0, 0, DateTimeKind.Utc), OfferWindow.EndsAtUtc(summer, "Europe/London"));
    }

    [Fact]
    public void Los_Angeles_and_Auckland_each_end_at_their_own_midnight()
    {
        var offer = Halloween();
        // Still Pacific Daylight Time at midnight on 1 Nov (it ends at 02:00 that morning).
        Assert.Equal(new DateTime(2026, 11, 1, 7, 0, 0, DateTimeKind.Utc), OfferWindow.EndsAtUtc(offer, "America/Los_Angeles"));
        // New Zealand Daylight Time, UTC+13.
        Assert.Equal(new DateTime(2026, 10, 31, 11, 0, 0, DateTimeKind.Utc), OfferWindow.EndsAtUtc(offer, "Pacific/Auckland"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Mars/Olympus_Mons")]
    [InlineData("+25:00")]
    public void An_unknown_zone_is_the_UKs(string? zone)
        => Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc), OfferWindow.EndsAtUtc(Halloween(), zone));

    [Fact]
    public void The_accounts_zone_wins_over_the_requests_and_either_over_the_UK()
    {
        Assert.Equal(
            new DateTime(2026, 11, 1, 7, 0, 0, DateTimeKind.Utc),
            OfferWindow.EndsAtUtc(Halloween(), OfferWindow.Resolve("America/Los_Angeles", "Pacific/Auckland")));
        Assert.Equal(
            new DateTime(2026, 10, 31, 11, 0, 0, DateTimeKind.Utc),
            OfferWindow.EndsAtUtc(Halloween(), OfferWindow.Resolve(null, "Pacific/Auckland")));
        Assert.Equal(
            new DateTime(2026, 10, 31, 23, 0, 0, DateTimeKind.Utc),
            OfferWindow.EndsAtUtc(Halloween(), OfferWindow.Resolve("+01:00", null)));
    }

    [Fact]
    public void It_is_live_only_while_on_after_the_start_and_before_the_persons_end()
    {
        var london = OfferWindow.Resolve("Europe/London");
        var offer = Halloween();
        Assert.False(OfferWindow.IsLiveFor(offer, london, OfferFixtures.Start.AddSeconds(-1)));
        Assert.True(OfferWindow.IsLiveFor(offer, london, OfferFixtures.Start));
        Assert.True(OfferWindow.IsLiveFor(offer, london, new DateTime(2026, 10, 31, 23, 59, 59, DateTimeKind.Utc)));
        Assert.False(OfferWindow.IsLiveFor(offer, london, new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc)));
        Assert.True(OfferWindow.HasEndedFor(offer, london, new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc)));

        // A zone is the client's word: −14:00 would end two hours after UTC−12, and gets no more than UTC−12 does.
        var farWest = OfferWindow.Resolve("-14:00");
        Assert.True(OfferWindow.IsLiveFor(offer, farWest, offer.LatestEndUtc.AddSeconds(-1)));
        Assert.False(OfferWindow.IsLiveFor(offer, farWest, offer.LatestEndUtc));

        offer.SetEnabled(false, OfferFixtures.Start);
        Assert.False(OfferWindow.IsLiveFor(offer, london, OfferFixtures.Midweek));
        Assert.True(OfferWindow.HasEndedFor(offer, london, OfferFixtures.Midweek)); // switched off after it started
        Assert.False(OfferWindow.HasEndedFor(offer, london, OfferFixtures.Start.AddDays(-1)));
    }

    [Fact]
    public void The_worldwide_window_runs_from_the_start_to_midnight_at_UTC_minus_12()
    {
        var offer = Halloween();
        Assert.Equal(new DateTime(2026, 10, 31, 10, 0, 0, DateTimeKind.Utc), offer.EarliestEndUtc);
        Assert.Equal(new DateTime(2026, 11, 1, 12, 0, 0, DateTimeKind.Utc), offer.LatestEndUtc);
        Assert.False(offer.HasEndedEverywhere(new DateTime(2026, 11, 1, 11, 59, 0, DateTimeKind.Utc)));
        Assert.True(offer.HasEndedEverywhere(offer.LatestEndUtc));

        // Christmas 2026 starts long after Halloween has ended everywhere; one that starts on 1 Nov does not.
        Assert.False(offer.Overlaps(Halloween(start: new DateTime(2026, 12, 14, 9, 0, 0, DateTimeKind.Utc), lastDay: new DateOnly(2026, 12, 26))));
        Assert.True(offer.Overlaps(Halloween(start: new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc), lastDay: new DateOnly(2026, 11, 7))));
    }

    // ── Templates ────────────────────────────────────────────────────────────

    [Fact]
    public void The_templates_default_to_the_boards_dates_at_09_00_UK_time()
    {
        var now = new DateTime(2026, 10, 21, 12, 0, 0, DateTimeKind.Utc);
        var halloween = OfferTemplates.HalloweenTemplate;
        Assert.Equal(new DateOnly(2026, 10, 31), halloween.NextLastDay(now));
        Assert.Equal(new DateTime(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc), halloween.StartsAtUtcFor(new DateOnly(2026, 10, 31)));
        Assert.Equal("Halloween 2026", halloween.NameFor(new DateOnly(2026, 10, 31)));

        var christmas = OfferTemplates.ChristmasTemplate;
        Assert.Equal(new DateOnly(2026, 12, 26), christmas.NextLastDay(now));
        Assert.Equal(new DateTime(2026, 12, 14, 9, 0, 0, DateTimeKind.Utc), christmas.StartsAtUtcFor(new DateOnly(2026, 12, 26)));

        // Once this year's has gone, next year's; a Monday start in summer time is 08:00 UTC.
        Assert.Equal(new DateOnly(2027, 10, 31), halloween.NextLastDay(new DateTime(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc)));
        Assert.Equal(new DateTime(2027, 10, 25, 8, 0, 0, DateTimeKind.Utc), halloween.StartsAtUtcFor(new DateOnly(2027, 10, 31)));
    }

    [Fact]
    public void The_words_carry_the_percent_as_a_placeholder()
    {
        var words = OfferTemplates.HalloweenTemplate.Words;
        Assert.Equal("30% off Pro, until Halloween", OfferTemplates.Fill(words.Subject, 30));
        Assert.Equal("Pro is 25% off until Halloween", OfferTemplates.Fill(words.Headline, 25));
        Assert.Equal("Halloween offer", OfferTemplates.LabelOf("halloween"));
        Assert.Equal("Christmas offer", OfferTemplates.LabelOf("christmas"));
    }

    [Fact]
    public void A_click_token_is_unguessable_and_url_safe()
    {
        var tokens = Enumerable.Range(0, 200).Select(_ => OfferTokens.New()).ToList();
        Assert.All(tokens, t =>
        {
            Assert.Equal(22, t.Length);
            Assert.Matches("^[A-Za-z0-9_-]+$", t);
        });
        Assert.Equal(tokens.Count, tokens.Distinct().Count());
    }

    private static Offer Halloween(DateOnly? lastDay = null, DateTime? start = null)
    {
        var t = OfferTemplates.HalloweenTemplate;
        var offer = Offer.Create(
            "halloween-2026", "Halloween 2026", "halloween", 30, true, true, start ?? OfferFixtures.Start, lastDay ?? OfferFixtures.LastDay,
            t.Words.Subject, t.Words.Preheader, t.Words.Headline, t.Words.Body, Guid.NewGuid(), null, OfferFixtures.Start.AddDays(-7));
        offer.SetEnabled(true, OfferFixtures.Start.AddDays(-7));
        return offer;
    }
}
