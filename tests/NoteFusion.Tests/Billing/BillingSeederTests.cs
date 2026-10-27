using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// What the paywall actually offers, as opposed to what a test seeds by hand. Every other billing test
/// creates its own plan rows, so nothing else would notice if the seeder disagreed with the eligibility rule
/// — and the failure mode is not an exception but a wrong price list, which ships green.
/// <para>
/// The retirement half is the sharper edge: it writes to rows that already exist in a live database. Taking
/// the wrong plan off sale empties someone's paywall, and leaving an unpayable one on it offers a checkout
/// that cannot complete.
/// </para>
/// </summary>
public class BillingSeederTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- what gets seeded

    [Fact]
    public async Task The_offered_plans_are_seeded_once_each()
    {
        using var h = new TestHarness(Now);

        await Seed(h);

        var plans = await h.Db.Plans.OrderBy(p => p.Code).ToListAsync();
        Assert.Equal(
            ["choir_monthly_ngn", "choir_monthly_usd", "choir_monthly_usd_regional",
             "choir_yearly_ngn", "choir_yearly_usd", "choir_yearly_usd_regional",
             "one_song_ngn_v2", "one_song_usd", "one_song_usd_regional_v3",
             "pro_monthly_ngn", "pro_monthly_usd", "pro_monthly_usd_regional",
             "pro_yearly_ngn_v2", "pro_yearly_usd", "pro_yearly_usd_regional"],
            plans.Select(p => p.Code));
        Assert.All(plans, p => Assert.True(p.IsActive));
    }

    [Fact]
    public async Task Both_tiers_recur_and_the_dollar_tier_costs_more()
    {
        // The international tier is the target market and is priced above the naira tier on purpose; the
        // naira tier is priced to local purchasing power. Neither tier is sold for life any more.
        using var h = new TestHarness(Now);

        await Seed(h);

        var naira = await h.Db.Plans.Where(p => p.Currency == "NGN" && p.Interval != BillingInterval.Single && p.ChoirSeats == null).OrderBy(p => p.AmountMinor).ToListAsync();
        Assert.Equal([BillingInterval.Monthly, BillingInterval.Yearly], naira.Select(p => p.Interval));
        Assert.Equal([750_000L, 6_000_000L], naira.Select(p => p.AmountMinor)); // ₦7,500 and ₦60,000, in kobo

        var dollars = (await h.Db.Plans.Where(p => p.Currency == "USD" && p.Interval != BillingInterval.Single && p.ChoirSeats == null).OrderBy(p => p.AmountMinor).ToListAsync())
            .Where(p => PlanEligibility.TierOf(p.Code, p.Currency) == PlanEligibility.Tier.StandardDollar)
            .ToList();
        Assert.Equal([BillingInterval.Monthly, BillingInterval.Yearly], dollars.Select(p => p.Interval));
        Assert.Equal([999L, 7_900L], dollars.Select(p => p.AmountMinor)); // $9.99 and $79, in cents

        Assert.DoesNotContain(await h.Db.Plans.ToListAsync(), p => p.Interval == BillingInterval.Lifetime);
    }

    [Fact]
    public async Task Seeding_twice_changes_nothing()
    {
        // It runs on every boot, and Heroku restarts a dyno daily.
        using var h = new TestHarness(Now);

        await Seed(h);
        await Seed(h);

        Assert.Equal(15, await h.Db.Plans.CountAsync());
    }

    // ---------------------------------------------------------------- what gets retired

    [Fact]
    public async Task An_unpayable_dollar_subscription_is_taken_off_sale()
    {
        // These two were the whole catalogue before the split, and they are worse than superseded: Bachs
        // subscriptions are card-only, this account has no USD card rail, and their checkout renders an empty
        // payment-method list. Left active they would sit on an international paywall as tiers that cannot
        // complete.
        using var h = new TestHarness(Now);
        h.Db.Plans.AddRange(
            Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 499, "USD", BillingInterval.Monthly),
            Plan.Create(Guid.NewGuid(), "pro_yearly", "Pro Yearly", 4990, "USD", BillingInterval.Yearly));
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var retired = await h.Db.Plans.Where(p => p.Code == "pro_monthly" || p.Code == "pro_yearly").ToListAsync();
        Assert.Equal(2, retired.Count);
        Assert.All(retired, p => Assert.False(p.IsActive));
    }

    [Fact]
    public async Task A_retired_plan_is_still_there_to_be_read()
    {
        // Deleting it would be the obvious move and the wrong one. Fulfilment, the receipt email and the
        // "my subscription" query all reach for the plan by id to name what was bought, long after it stops
        // being on sale — and a charge nobody can name is a support ticket nobody can answer.
        using var h = new TestHarness(Now);
        var old = Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(old);
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var found = await h.Db.Plans.FirstOrDefaultAsync(p => p.Id == old.Id);
        Assert.NotNull(found);
        Assert.Equal(499, found.AmountMinor);
        Assert.Equal("Pro Monthly", found.Name);
    }

    [Fact]
    public async Task A_plan_created_by_hand_is_retired_by_its_code()
    {
        // test_ngn_monthly was a probe made straight against the live database, so its id is nothing the
        // seeder could derive. Matching on code is what reaches it.
        using var h = new TestHarness(Now);
        h.Db.Plans.Add(Plan.Create(
            Guid.NewGuid(), "test_ngn_monthly", "Test NGN", 100_000, "NGN", BillingInterval.Monthly));
        await h.Db.SaveChangesAsync();

        await Seed(h);

        Assert.False((await h.Db.Plans.SingleAsync(p => p.Code == "test_ngn_monthly")).IsActive);
    }

    [Fact]
    public async Task A_repriced_tier_ships_as_a_new_code_and_leaves_the_old_price_intact()
    {
        // The naira yearly went from ₦75,000 to ₦60,000. The tempting move is to edit the amount on
        // pro_yearly_ngn, and it would quietly rewrite history: fulfilment and the receipt read the plan by
        // id, so every past buyer's record would start claiming they agreed to the new price. Instead the new
        // price is a new code and the old one comes off sale still holding the number it was sold at.
        using var h = new TestHarness(Now);
        var old = Plan.Create(
            Guid.NewGuid(), "pro_yearly_ngn", "NoteFusion Pro (Yearly)", 7_500_000, "NGN", BillingInterval.Yearly);
        h.Db.Plans.Add(old);
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var previous = await h.Db.Plans.SingleAsync(p => p.Code == "pro_yearly_ngn");
        Assert.False(previous.IsActive);
        Assert.Equal(7_500_000, previous.AmountMinor);

        var current = await h.Db.Plans.SingleAsync(p => p.Code == "pro_yearly_ngn_v2");
        Assert.True(current.IsActive);
        Assert.Equal(6_000_000, current.AmountMinor);

        // And only one yearly is on the naira paywall, or the buyer picks their own price.
        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, "NG"))
            .ToList();
        Assert.Equal("pro_yearly_ngn_v2", Assert.Single(offered, p => p.Interval == BillingInterval.Yearly && !p.IsChoir).Code);
    }

    [Fact]
    public async Task The_regional_one_song_moves_to_a_dollar_as_a_new_code()
    {
        // $0.99 was under Bachs' minimum checkout of 1 USD, so every regional one-song checkout was refused before
        // the payment page opened. The old row comes off sale at the price it was listed at; the one on sale now
        // ($1.99, one_song_usd_regional_v3) is the only one song the regional paywall offers.
        using var h = new TestHarness(Now);
        h.Db.Plans.Add(Plan.Create(Guid.NewGuid(), "one_song_usd_regional", "One song", 99, "USD", BillingInterval.Single));
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var previous = await h.Db.Plans.SingleAsync(p => p.Code == "one_song_usd_regional");
        Assert.False(previous.IsActive);
        Assert.Equal(99, previous.AmountMinor);

        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, "KE"))
            .ToList();
        var single = Assert.Single(offered, p => p.Interval == BillingInterval.Single);
        Assert.Equal("one_song_usd_regional_v3", single.Code);
        Assert.Equal(199, single.AmountMinor);
    }

    [Theory]
    [InlineData("one_song_usd_regional_v2", 100, "USD", "KE", "one_song_usd_regional_v3", 199)]
    [InlineData("one_song_ngn", 150_000, "NGN", "NG", "one_song_ngn_v2", 300_000)]
    public async Task A_song_under_1_99_comes_off_sale_at_its_old_price_and_its_new_code_takes_over(
        string oldCode, long oldMinor, string currency, string country, string newCode, long newMinor)
    {
        // No region sells a song for less than $1.99: ₦1,500 was about $1. The old row keeps the price it was listed at.
        using var h = new TestHarness(Now);
        h.Db.Plans.Add(Plan.Create(Guid.NewGuid(), oldCode, "One song", oldMinor, currency, BillingInterval.Single));
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var previous = await h.Db.Plans.SingleAsync(p => p.Code == oldCode);
        Assert.False(previous.IsActive);
        Assert.Equal(oldMinor, previous.AmountMinor);

        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, country))
            .ToList();
        var single = Assert.Single(offered, p => p.Interval == BillingInterval.Single);
        Assert.Equal(newCode, single.Code);
        Assert.Equal(newMinor, single.AmountMinor);
    }

    [Fact]
    public async Task Every_plan_on_sale_meets_the_gateways_minimum_charge()
    {
        // Bachs refuses a checkout under 1 USD, and NGN's floor is ₦100 (minor units: 100 cents, 10,000 kobo).
        using var h = new TestHarness(Now);
        await Seed(h);

        var minimum = new Dictionary<string, long> { ["USD"] = 100, ["NGN"] = 10_000 };
        var onSale = await h.Db.Plans.Where(p => p.IsActive).ToListAsync();
        Assert.NotEmpty(onSale);
        Assert.All(onSale, p => Assert.True(
            p.AmountMinor >= minimum[p.Currency], $"{p.Code} is {p.AmountMinor} {p.Currency}, under the gateway's minimum"));
    }

    [Fact]
    public async Task Lifetime_is_withdrawn_but_its_buyers_keep_their_plan_row()
    {
        using var h = new TestHarness(Now);
        var lifetime = Plan.Create(
            Guid.NewGuid(), "pro_lifetime_v2", "NoteFusion Pro (Lifetime)", 20_000, "USD", BillingInterval.Lifetime);
        h.Db.Plans.Add(lifetime);
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var found = await h.Db.Plans.SingleAsync(p => p.Code == "pro_lifetime_v2");
        Assert.False(found.IsActive);
        Assert.Equal(20_000, found.AmountMinor); // the receipt of a $200 buyer still says $200
    }

    // ---------------------------------------------------------------- the seeder against the rule

    [Theory]
    [InlineData("NG", 5)]  // monthly, yearly, one song and the two choir plans, in naira
    [InlineData("GB", 5)]  // the same in dollars
    [InlineData("US", 5)]
    [InlineData("KE", 5)]  // the regional dollar set
    [InlineData("IN", 5)]
    [InlineData(null, 10)] // no country known: naira and standard dollars, rather than a guessed one
    public async Task What_a_region_is_actually_offered_after_seeding(string? country, int expected)
    {
        // The two halves of the feature meet here. PlanEligibilityTests proves the rule against hand-made
        // rows; this proves the rows the product ships are the ones the rule was written for.
        using var h = new TestHarness(Now);
        await Seed(h);

        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, country))
            .ToList();

        Assert.Equal(expected, offered.Count);
        if (country is not null) // one tier per known country, never two prices for the same thing
        {
            Assert.Single(offered, p => p.Interval == BillingInterval.Single);
            Assert.Single(offered.Select(p => PlanEligibility.TierOf(p.Code, p.Currency)).Distinct());
        }
        else
        {
            Assert.DoesNotContain(offered, p => PlanEligibility.TierOf(p.Code, p.Currency) == PlanEligibility.Tier.RegionalDollar);
        }
    }

    [Fact]
    public async Task The_regional_and_one_song_prices_are_the_ones_agreed()
    {
        using var h = new TestHarness(Now);
        await Seed(h);

        var plans = await h.Db.Plans.ToDictionaryAsync(p => p.Code);
        Assert.Equal(499, plans["pro_monthly_usd_regional"].AmountMinor);  // $4.99
        Assert.Equal(3_999, plans["pro_yearly_usd_regional"].AmountMinor); // $39.99
        Assert.Equal(300_000, plans["one_song_ngn_v2"].AmountMinor);       // ₦3,000, in kobo: about $1.99
        Assert.Equal(199, plans["one_song_usd"].AmountMinor);              // $1.99
        Assert.Equal(199, plans["one_song_usd_regional_v3"].AmountMinor);  // $1.99: no song sells for less
        Assert.All(plans.Values.Where(p => p.Code.StartsWith("one_song")), p => Assert.Equal(BillingInterval.Single, p.Interval));
    }

    [Fact]
    public async Task The_choir_prices_and_seats_are_the_ones_agreed()
    {
        using var h = new TestHarness(Now);
        await Seed(h);

        var plans = await h.Db.Plans.ToDictionaryAsync(p => p.Code);
        Assert.Equal(2_500_000, plans["choir_monthly_ngn"].AmountMinor);        // ₦25,000, in kobo
        Assert.Equal(25_000_000, plans["choir_yearly_ngn"].AmountMinor);        // ₦250,000
        Assert.Equal(1_999, plans["choir_monthly_usd"].AmountMinor);            // $19.99
        Assert.Equal(19_900, plans["choir_yearly_usd"].AmountMinor);            // $199
        Assert.Equal(999, plans["choir_monthly_usd_regional"].AmountMinor);     // $9.99
        Assert.Equal(9_900, plans["choir_yearly_usd_regional"].AmountMinor);    // $99
        var choirPlans = plans.Values.Where(p => p.Code.StartsWith("choir_")).ToList();
        Assert.Equal(6, choirPlans.Count);
        Assert.All(choirPlans, p => Assert.Equal(25, p.ChoirSeats));
        Assert.All(plans.Values.Where(p => !p.Code.StartsWith("choir_")), p => Assert.Null(p.ChoirSeats));
    }

    // ---------------------------------------------------------------- fixtures

    /// <summary>
    /// Runs the real hosted service against the harness database. The seeder resolves its context from a
    /// scope, so it needs a container — a minimal one holding the same context instance the test asserts on.
    /// </summary>
    private static async Task Seed(TestHarness h)
    {
        var services = new ServiceCollection();
        services.AddSingleton(h.Db);
        services.AddSingleton<IDateTimeProvider>(h.Clock);

        // Not disposed: the container would dispose the context it was handed, and the test still has
        // assertions to make against it. The harness owns that lifetime.
        var provider = services.BuildServiceProvider();

        await new BillingSeeder(provider, NullLogger<BillingSeeder>.Instance).StartAsync(default);
    }
}
