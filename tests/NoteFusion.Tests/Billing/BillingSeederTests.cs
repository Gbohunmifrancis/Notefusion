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
        Assert.Equal(["pro_lifetime_v2", "pro_monthly_ngn", "pro_yearly_ngn"], plans.Select(p => p.Code));
        Assert.All(plans, p => Assert.True(p.IsActive));
    }

    [Fact]
    public async Task The_naira_tier_recurs_and_the_dollar_tier_does_not()
    {
        // The whole point of the split: naira is a Paystack subscription, dollars are a single Bachs charge.
        // An interval slipped here would route a lifetime buyer into the recurring Bachs mode that cannot be
        // paid at all, which is the defect this arrangement exists to route around.
        using var h = new TestHarness(Now);

        await Seed(h);

        var naira = await h.Db.Plans.Where(p => p.Currency == "NGN").ToListAsync();
        Assert.Equal(
            [BillingInterval.Monthly, BillingInterval.Yearly],
            naira.Select(p => p.Interval).Order());

        var dollars = Assert.Single(await h.Db.Plans.Where(p => p.Currency == "USD").ToListAsync());
        Assert.Equal(BillingInterval.Lifetime, dollars.Interval);
        Assert.Equal(20_000, dollars.AmountMinor); // $200.00, in cents
    }

    [Fact]
    public async Task Seeding_twice_changes_nothing()
    {
        // It runs on every boot, and Heroku restarts a dyno daily.
        using var h = new TestHarness(Now);

        await Seed(h);
        await Seed(h);

        Assert.Equal(3, await h.Db.Plans.CountAsync());
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
        // Lifetime went from $79 to $200. The tempting move is to edit the amount on pro_lifetime, and it
        // would quietly rewrite history: fulfilment and the receipt read the plan by id, so every past buyer's
        // record would start claiming they agreed to $200. Instead the new price is a new code and the old one
        // comes off sale still holding the number it was sold at.
        using var h = new TestHarness(Now);
        var old = Plan.Create(
            Guid.NewGuid(), "pro_lifetime", "NoteFusion Pro (Lifetime)", 7_900, "USD", BillingInterval.Lifetime);
        h.Db.Plans.Add(old);
        await h.Db.SaveChangesAsync();

        await Seed(h);

        var previous = await h.Db.Plans.SingleAsync(p => p.Code == "pro_lifetime");
        Assert.False(previous.IsActive);
        Assert.Equal(7_900, previous.AmountMinor);

        var current = await h.Db.Plans.SingleAsync(p => p.Code == "pro_lifetime_v2");
        Assert.True(current.IsActive);
        Assert.Equal(20_000, current.AmountMinor);

        // And only one of them is on the international paywall, or the buyer picks their own price.
        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Currency, "US"))
            .ToList();
        Assert.Equal("pro_lifetime_v2", Assert.Single(offered).Code);
    }

    // ---------------------------------------------------------------- the seeder against the rule

    [Theory]
    [InlineData("NG", 2)]  // monthly and yearly, in naira
    [InlineData("GB", 1)]  // the lifetime, and nothing that recurs in a currency they cannot be charged
    [InlineData("US", 1)]
    [InlineData(null, 3)]  // no country known: every tier, rather than a guessed one
    public async Task What_a_region_is_actually_offered_after_seeding(string? country, int expected)
    {
        // The two halves of the feature meet here. PlanEligibilityTests proves the rule against hand-made
        // rows; this proves the rows the product ships are the ones the rule was written for.
        using var h = new TestHarness(Now);
        await Seed(h);

        var offered = (await h.Db.Plans.Where(p => p.IsActive).ToListAsync())
            .Where(p => PlanEligibility.IsOffered(p.Currency, country))
            .ToList();

        Assert.Equal(expected, offered.Count);
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
