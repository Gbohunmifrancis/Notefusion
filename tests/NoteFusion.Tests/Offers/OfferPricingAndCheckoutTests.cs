using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Application.Offers.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// What the website and the web app are told (<c>GET /api/offers/current</c>), what the checkout charges with an
/// <c>offerKey</c>, and the email button's click: a price shown is a price charged, and only to someone it is for.
/// </summary>
public class OfferPricingAndCheckoutTests
{
    // ── GET /api/offers/current ──────────────────────────────────────────────

    [Fact]
    public async Task An_anonymous_visitor_whose_country_is_unknown_sees_the_standard_dollar_prices_ending_at_UK_midnight()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);

        var current = await Current(h, user: null);

        var offer = Assert.IsType<LiveOfferDto>(current.Offer);
        Assert.Equal(("halloween-2026", "Halloween offer", 30), (offer.Key, offer.Label, offer.PercentOff));
        Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc), offer.EndsAtUtc);
        Assert.Equal(new DateOnly(2026, 10, 31), offer.LastDay);
        Assert.Equal(
            new[] { (plans.Monthly.Id, "Monthly", 999L, 699L), (plans.Yearly.Id, "Yearly", 7_900L, 5_500L) },
            offer.Plans.Select(p => (p.PlanId, p.Interval, p.AmountMinor, p.OfferAmountMinor)));
        Assert.Null(current.Ended);
    }

    [Fact]
    public async Task An_anonymous_visitor_is_priced_by_their_country_and_timed_by_their_X_Time_Zone()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        h.Country.Country = "KE";

        var offer = (await Current(h, user: null, zone: "America/Los_Angeles")).Offer!;

        Assert.Equal(new[] { plans.RegionalMonthly.Id, plans.RegionalYearly.Id }, offer.Plans.Select(p => p.PlanId));
        Assert.Equal(new long[] { 349, 2_799 }, offer.Plans.Select(p => p.OfferAmountMinor));
        Assert.Equal(new DateTime(2026, 11, 1, 7, 0, 0, DateTimeKind.Utc), offer.EndsAtUtc);
    }

    [Fact]
    public async Task A_naira_account_is_never_offered_it_nor_told_it_ended()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        AddOffer(h);
        var ada = Account(h, "ada@example.com", "NG");

        var current = await Current(h, ada, key: "halloween-2026");
        Assert.Null(current.Offer);
        Assert.Null(current.Ended);

        h.Clock.UtcNow = new DateTime(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc);
        Assert.Null((await Current(h, ada, key: "halloween-2026")).Ended);
    }

    [Fact]
    public async Task A_regional_account_sees_its_own_set_and_its_own_midnight()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var kofi = Account(h, "kofi@example.com", "GH", zone: "Africa/Accra");

        var offer = (await Current(h, kofi, zone: "Pacific/Auckland")).Offer!;

        Assert.Equal(new[] { plans.RegionalMonthly.Id, plans.RegionalYearly.Id }, offer.Plans.Select(p => p.PlanId));
        // The account's own zone, not the request's.
        Assert.Equal(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc), offer.EndsAtUtc);
    }

    [Fact]
    public async Task A_Google_Play_member_is_not_offered_it_but_a_web_billed_member_is()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var play = Account(h, "play@example.com", "US");
        Subscribe(h, play, plans.Monthly, PaymentProvider.GooglePlay, Midweek.AddDays(10));
        var web = Account(h, "web@example.com", "US");
        Subscribe(h, web, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(10));

        Assert.Null((await Current(h, play)).Offer);
        Assert.Equal(new long[] { 699, 5_500 }, (await Current(h, web)).Offer!.Plans.Select(p => p.OfferAmountMinor));
    }

    [Fact]
    public async Task Nothing_shows_before_the_start_or_while_switched_off_and_only_the_plans_it_covers_show()
    {
        using var h = new TestHarness(Start.AddMinutes(-1));
        var plans = AddPlans(h);
        var offer = AddOffer(h, yearly: false);
        var grace = Account(h, "grace@example.com");

        Assert.Null((await Current(h, grace)).Offer);

        h.Clock.UtcNow = Midweek;
        Assert.Equal(new[] { plans.Monthly.Id }, (await Current(h, grace)).Offer!.Plans.Select(p => p.PlanId));

        offer.SetEnabled(false, Midweek);
        h.Db.SaveChanges();
        var off = await Current(h, grace, key: offer.Key);
        Assert.Null(off.Offer);
        Assert.Equal(new EndedOfferDto("halloween-2026", "Halloween offer"), off.Ended);
    }

    [Fact]
    public async Task A_link_to_an_offer_that_has_ended_where_they_are_says_so()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc));
        AddPlans(h);
        AddOffer(h);
        var kiwi = Account(h, "kiwi@example.com", "NZ", zone: "Pacific/Auckland");
        var brit = Account(h, "brit@example.com", "GB", zone: "Europe/London");

        // Past midnight in Auckland, still Saturday afternoon in London.
        var nz = await Current(h, kiwi, key: "HALLOWEEN-2026");
        Assert.Null(nz.Offer);
        Assert.Equal(new EndedOfferDto("halloween-2026", "Halloween offer"), nz.Ended);
        var uk = await Current(h, brit, key: "halloween-2026");
        Assert.NotNull(uk.Offer);
        Assert.Null(uk.Ended);

        // A key that names nothing is not an ended offer.
        Assert.Null((await Current(h, brit, key: "easter-2026")).Ended);
    }

    // ── Checkout ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Without_a_key_the_checkout_charges_the_usual_price()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var gateway = new FakeGateway();

        var session = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web"));

        Assert.True(session.IsSuccess);
        var tx = h.Db.PaymentTransactions.Single();
        Assert.Equal((999L, (Guid?)null), (tx.AmountMinor, tx.OfferId));
        Assert.Equal(999, Assert.Single(gateway.Initiated).AmountMinor);
    }

    [Fact]
    public async Task With_a_live_key_the_checkout_charges_the_offer_price_and_marks_the_payment()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var kofi = Account(h, "kofi@example.com", "GH");
        var gateway = new FakeGateway();

        Assert.True((await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Yearly.Id, "web", "halloween-2026"))).IsSuccess);
        Assert.True((await Checkout(h, kofi, gateway, new InitiateCheckoutCommand(plans.RegionalMonthly.Id, "web", " Halloween-2026 "))).IsSuccess);

        var graceTx = h.Db.PaymentTransactions.Single(t => t.UserId == grace.Id);
        Assert.Equal((5_500L, (Guid?)offer.Id), (graceTx.AmountMinor, graceTx.OfferId));
        var kofiTx = h.Db.PaymentTransactions.Single(t => t.UserId == kofi.Id);
        Assert.Equal((349L, (Guid?)offer.Id), (kofiTx.AmountMinor, kofiTx.OfferId));
        Assert.Equal(new long[] { 5_500, 349 }, gateway.Initiated.Select(i => i.AmountMinor));
    }

    [Fact]
    public async Task An_ended_unknown_or_uncovered_offer_is_refused_with_BILLING_OFFER_ENDED()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h, yearly: false);
        var grace = Account(h, "grace@example.com", zone: "Europe/London");
        var gateway = new FakeGateway();

        var yearly = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Yearly.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", yearly.Error.Code);
        Assert.Equal("The Halloween offer has ended, so Pro is back to its usual price.", yearly.Error.Message);

        var single = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.OneSong.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", single.Error.Code);

        var unknown = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "easter-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", unknown.Error.Code);

        h.Clock.UtcNow = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);
        var ended = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", ended.Error.Code);

        Assert.Empty(gateway.Initiated);
        Assert.Empty(h.Db.PaymentTransactions);
    }

    [Fact]
    public async Task The_end_is_the_buyers_own_from_the_request_when_the_account_has_none()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc));
        var plans = AddPlans(h);
        AddOffer(h);
        var kiwi = Account(h, "kiwi@example.com", "NZ");

        var refused = await Checkout(h, kiwi, new FakeGateway(), new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"), zone: "Pacific/Auckland");
        Assert.Equal("BILLING_OFFER_ENDED", refused.Error.Code);
        Assert.True((await Checkout(h, kiwi, new FakeGateway(), new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"))).IsSuccess);
    }

    [Fact]
    public async Task A_checkout_opened_before_the_end_keeps_its_price_for_the_reuse_window()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 31, 23, 50, 0, DateTimeKind.Utc));
        var plans = AddPlans(h);
        AddOffer(h);
        var grace = Account(h, "grace@example.com", zone: "Europe/London");
        var gateway = new FakeGateway();

        var first = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));
        Assert.True(first.IsSuccess);

        // Ten minutes past midnight: the offer is over for Grace, but the session she opened is handed back.
        h.Clock.UtcNow = new DateTime(2026, 11, 1, 0, 10, 0, DateTimeKind.Utc);
        var again = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));

        Assert.True(again.IsSuccess);
        Assert.Equal(first.Value.Reference, again.Value.Reference);
        Assert.Single(gateway.Initiated);
        Assert.Equal(699, h.Db.PaymentTransactions.Single().AmountMinor);

        // Past the window it is not, and the offer is gone.
        h.Clock.UtcNow = new DateTime(2026, 11, 1, 1, 0, 0, DateTimeKind.Utc);
        var late = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", late.Error.Code);
    }

    [Fact]
    public async Task A_checkout_at_the_offer_price_and_one_at_the_usual_price_never_stand_in_for_each_other()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var gateway = new FakeGateway();

        var normal = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web"));
        var offered = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));
        var normalAgain = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web"));
        var offeredAgain = await Checkout(h, grace, gateway, new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));

        Assert.NotEqual(normal.Value.Reference, offered.Value.Reference);
        Assert.Equal(normal.Value.Reference, normalAgain.Value.Reference);
        Assert.Equal(offered.Value.Reference, offeredAgain.Value.Reference);
        Assert.Equal(new long[] { 999, 699 }, gateway.Initiated.Select(i => i.AmountMinor));
    }

    [Fact]
    public async Task A_pending_row_at_the_usual_price_is_not_replayed_at_the_offer_price()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var pending = PaymentTransaction.Create(
            grace.Id, plans.Monthly.Id, PaymentProvider.Bachs, "checkout:NF_pending:web", "NF_pending", 999, "USD", Midweek.AddMinutes(-5), CheckoutClient.Web);
        h.Db.PaymentTransactions.Add(pending);
        h.Db.SaveChanges();

        var offered = await Checkout(h, grace, new FakeGateway(), new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));

        Assert.NotEqual("NF_pending", offered.Value.Reference);
        Assert.Equal(PaymentStatus.Pending, pending.Status);
    }

    [Fact]
    public async Task A_naira_account_cannot_reach_a_dollar_plan_through_an_offer_key()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        AddOffer(h);
        var ada = Account(h, "ada@example.com", "NG");

        var refused = await Checkout(h, ada, new FakeGateway(), new InitiateCheckoutCommand(plans.Monthly.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", refused.Error.Code);
        var naira = await Checkout(h, ada, new FakeGateway(), new InitiateCheckoutCommand(plans.NairaMonthly.Id, "web", "halloween-2026"));
        Assert.Equal("BILLING_OFFER_ENDED", naira.Error.Code);
    }

    // ── POST /api/offers/click ───────────────────────────────────────────────

    [Fact]
    public async Task A_click_is_counted_once_and_any_other_token_changes_nothing()
    {
        using var h = new TestHarness(Midweek);
        var offer = AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var row = OfferEmail.Queue(offer.Id, grace.Id, OfferEmailGroup.Free, "abcdefghijklmnopqrstuv", Midweek);
        h.Db.OfferEmails.Add(row);
        h.Db.SaveChanges();
        var handler = new RecordOfferClickCommandHandler(h.Db, h.Clock);

        Assert.True((await handler.Handle(new RecordOfferClickCommand("abcdefghijklmnopqrstuv"), default)).IsSuccess);
        h.Clock.UtcNow = Midweek.AddHours(1);
        await handler.Handle(new RecordOfferClickCommand("abcdefghijklmnopqrstuv"), default);
        Assert.True((await handler.Handle(new RecordOfferClickCommand("nope"), default)).IsSuccess);
        Assert.True((await handler.Handle(new RecordOfferClickCommand(null), default)).IsSuccess);
        Assert.True((await handler.Handle(new RecordOfferClickCommand("zzzzzzzzzzzzzzzzzzzzzz"), default)).IsSuccess);

        Assert.Equal(Midweek, h.Db.OfferEmails.AsNoTracking().Single().ClickedAtUtc);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static async Task<CurrentOfferDto> Current(TestHarness h, User? user, string? key = null, string? zone = null)
        => (await new GetCurrentOfferQueryHandler(
                h.Db, new StubCurrentUser(user?.Id), h.Country, new StubClientTimeZone(zone), h.Clock)
            .Handle(new GetCurrentOfferQuery(key), default)).Value;

    private static Task<NoteFusion.Shared.Results.Result<NoteFusion.Application.Billing.Dtos.CheckoutSessionDto>> Checkout(
        TestHarness h, User user, FakeGateway gateway, InitiateCheckoutCommand command, string? zone = null)
        => new InitiateCheckoutCommandHandler(
                h.Db, new StubCurrentUser(user.Id), new FakeFactory(gateway), h.Clock, new BillingSettings(), h.Email,
                new StubClientTimeZone(zone))
            .Handle(command, default);
}
