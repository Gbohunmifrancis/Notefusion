using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// The offer email worker: the queue's order, who is skipped at their turn and why, each person's own sending hours,
/// the quota and the provider stopping a run, a refused send's one retry, pausing, and the close after the end.
/// </summary>
public class OfferEmailServiceTests
{
    [Fact]
    public async Task Lapsed_go_first_then_free_by_last_seen_then_Pro_now_each_with_their_own_link_and_prices()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var member = Account(h, "member@example.com", "US", seen: Midweek.AddHours(-1));
        var oldFree = Account(h, "old@example.com", "GB", seen: Midweek.AddDays(-20));
        var lapsed = Account(h, "lapsed@example.com", "GB", seen: Midweek.AddDays(-40));
        var recentFree = Account(h, "recent@example.com", "GH", seen: Midweek.AddHours(-2));
        var rows = Queue(h, offer, (member, OfferEmailGroup.ProNow), (oldFree, OfferEmailGroup.Free), (lapsed, OfferEmailGroup.Lapsed), (recentFree, OfferEmailGroup.Free));

        Assert.Equal(4, await Run(h));

        Assert.Equal(
            ["lapsed@example.com", "recent@example.com", "old@example.com", "member@example.com"],
            h.Email.Offers.Select(o => o.To.Email));
        Assert.All(h.Email.Offers, o => Assert.False(o.Test));
        var kofi = h.Email.Offers.Single(o => o.To.Email == "recent@example.com").Email;
        Assert.Equal(new long[] { 349, 2_799 }, kofi.Prices.Select(p => p.OfferAmountMinor));
        var token = rows.Single(r => r.UserId == recentFree.Id).Token;
        Assert.Equal($"https://notefusion.studio/app?offer=halloween-2026&m={token}", kofi.OfferUrl);
        Assert.Equal($"https://api.notefusion.studio/api/offers/o/{token}", kofi.OpenPixelUrl);
        Assert.StartsWith("https://api.notefusion.studio/api/email/unsubscribe?token=", kofi.UnsubscribeUrl);
        Assert.Equal(recentFree.Id, new HmacEmailUnsubscribeTokens(h.Keys).Read(kofi.UnsubscribeUrl.Split("token=")[1]));
        Assert.All(h.Db.OfferEmails.AsNoTracking(), r => Assert.Equal((OfferEmailStatus.Sent, 1), (r.Status, r.Attempts)));
    }

    [Fact]
    public async Task At_their_turn_anyone_who_can_no_longer_take_it_is_skipped_with_the_reason()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var optedOut = Account(h, "off@example.com");
        var bought = Account(h, "bought@example.com");
        var becamePro = Account(h, "pro@example.com");
        var member = Account(h, "member@example.com");
        var moved = Account(h, "moved@example.com", country: null);
        var suspended = Account(h, "suspended@example.com");
        var fine = Account(h, "fine@example.com");
        Queue(h, offer,
            (optedOut, OfferEmailGroup.Free), (bought, OfferEmailGroup.Free), (becamePro, OfferEmailGroup.Lapsed),
            (member, OfferEmailGroup.ProNow), (moved, OfferEmailGroup.Free), (suspended, OfferEmailGroup.Free), (fine, OfferEmailGroup.Free));

        h.Db.EmailOptOuts.Add(EmailOptOut.Create(optedOut.Id, Midweek.AddHours(-1)));
        Payment(h, bought, plans.Monthly, 699, offer.Id, Midweek.AddHours(-1));
        Subscribe(h, becamePro, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(30));
        Subscribe(h, member, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(30));
        suspended.Suspend();
        h.Db.SaveChanges();

        Assert.Equal(2, await Run(h));

        Assert.Equal(["fine@example.com", "member@example.com"], h.Email.Offers.Select(o => o.To.Email).Order());
        Assert.Equal(OfferSkipReason.OptedOut, Reason(h, optedOut));
        Assert.Equal(OfferSkipReason.Bought, Reason(h, bought));
        Assert.Equal(OfferSkipReason.BecamePro, Reason(h, becamePro));
        Assert.Equal(OfferSkipReason.NoLongerEligible, Reason(h, moved));
        Assert.Equal(OfferSkipReason.NoLongerEligible, Reason(h, suspended));
    }

    [Fact]
    public async Task Each_person_hears_in_their_own_sending_hours_and_not_after_their_own_end()
    {
        // Saturday 31 Oct, 12:00 UTC: noon in London, 05:00 in Los Angeles, and past midnight in Auckland.
        using var h = new TestHarness(new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc));
        AddPlans(h);
        var offer = AddOffer(h);
        var london = Account(h, "london@example.com", "GB", zone: "Europe/London");
        var unknown = Account(h, "unknown@example.com", "GB");
        var la = Account(h, "la@example.com", "US", zone: "America/Los_Angeles");
        var auckland = Account(h, "nz@example.com", "NZ", zone: "Pacific/Auckland");
        Queue(h, offer, (london, OfferEmailGroup.Free), (unknown, OfferEmailGroup.Free), (la, OfferEmailGroup.Free), (auckland, OfferEmailGroup.Free));

        Assert.Equal(2, await Run(h));
        Assert.Equal(["london@example.com", "unknown@example.com"], h.Email.Offers.Select(o => o.To.Email).Order());
        Assert.Equal(OfferSkipReason.Ended, Reason(h, auckland));
        Assert.Equal(OfferEmailStatus.Queued, Row(h, la).Status);

        // Los Angeles' morning.
        h.Clock.UtcNow = new DateTime(2026, 10, 31, 17, 0, 0, DateTimeKind.Utc);
        Assert.Equal(1, await Run(h));
        Assert.Equal(OfferEmailStatus.Sent, Row(h, la).Status);
    }

    [Fact]
    public async Task No_room_in_the_quota_stops_the_run_and_keeps_everyone_queued()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        Queue(h, offer, (Account(h, "a@example.com"), OfferEmailGroup.Free), (Account(h, "b@example.com"), OfferEmailGroup.Free));
        var quota = new NoRoom();

        Assert.Equal(0, await Run(h, quota: quota));

        Assert.Equal(1, quota.Asked);
        Assert.Empty(h.Email.Offers);
        Assert.All(h.Db.OfferEmails.AsNoTracking(), r => Assert.Equal((OfferEmailStatus.Queued, 0), (r.Status, r.Attempts)));
    }

    [Fact]
    public async Task A_refused_send_is_tried_once_more_and_a_provider_outage_spends_no_try()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var grace = Account(h, "grace@example.com");
        Queue(h, offer, (grace, OfferEmailGroup.Free));

        h.Email.OfferError = ProviderErrors.Unavailable;
        Assert.Equal(0, await Run(h));
        Assert.Equal((OfferEmailStatus.Queued, 0), (Row(h, grace).Status, Row(h, grace).Attempts));

        h.Email.OfferError = Error.Failure("EMAIL_DELIVERY_FAILED", "Resend returned 422 (UnprocessableEntity).");
        await Run(h);
        Assert.Equal((OfferEmailStatus.Queued, 1), (Row(h, grace).Status, Row(h, grace).Attempts));
        await Run(h);
        var failed = Row(h, grace);
        Assert.Equal((OfferEmailStatus.Failed, 2), (failed.Status, failed.Attempts));
        Assert.Contains("422", failed.LastError);

        await Run(h);
        Assert.Equal(3, h.Email.Offers.Count); // the outage's refusal and the two tries; never a third
    }

    [Fact]
    public async Task Nothing_goes_while_paused_switched_off_or_before_the_start()
    {
        using var h = new TestHarness(Start.AddHours(-1));
        AddPlans(h);
        var offer = AddOffer(h);
        Queue(h, offer, (Account(h, "grace@example.com"), OfferEmailGroup.Free));

        Assert.Equal(0, await Run(h)); // not started

        h.Clock.UtcNow = Midweek;
        offer.SetSendPaused(true, Midweek);
        h.Db.SaveChanges();
        Assert.Equal(0, await Run(h));

        offer.SetSendPaused(false, Midweek);
        offer.SetEnabled(false, Midweek);
        h.Db.SaveChanges();
        Assert.Equal(0, await Run(h));

        offer.SetEnabled(true, Midweek);
        h.Db.SaveChanges();
        Season(h, offer.Template, on: false); // the Halloween season switched off in Feature flags
        Assert.Equal(0, await Run(h));
        Assert.Equal(0, h.Db.OfferEmails.Single().Attempts);

        Season(h, offer.Template, on: true);
        Assert.Equal(1, await Run(h));
    }

    [Fact]
    public async Task Once_it_has_ended_everywhere_whatever_is_still_queued_is_skipped_as_ended()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var la = Account(h, "la@example.com", "US", zone: "America/Los_Angeles");
        Queue(h, offer, (la, OfferEmailGroup.Free));
        offer.SetSendPaused(true, Midweek);
        h.Db.SaveChanges();

        h.Clock.UtcNow = offer.LatestEndUtc;
        Assert.Equal(0, await Run(h));

        Assert.Equal(OfferSkipReason.Ended, Reason(h, la));
    }

    [Fact]
    public async Task A_run_sends_at_most_its_batch()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        Queue(h, offer, Enumerable.Range(0, 5).Select(i => (Account(h, $"p{i}@example.com"), OfferEmailGroup.Free)).ToArray());

        Assert.Equal(3, await Run(h, batch: 3));
        Assert.Equal(2, await Run(h, batch: 3));
        Assert.Equal(0, await Run(h, batch: 3));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static List<OfferEmail> Queue(TestHarness h, Offer offer, params (User User, OfferEmailGroup Group)[] people)
    {
        offer.StartSending(true, true, true, Guid.NewGuid(), Start.AddHours(-2));
        var rows = people.Select(p => OfferEmail.Queue(offer.Id, p.User.Id, p.Group, OfferTokens.New(), Start.AddHours(-2))).ToList();
        h.Db.OfferEmails.AddRange(rows);
        h.Db.SaveChanges();
        return rows;
    }

    private static Task<int> Run(TestHarness h, IEmailQuota? quota = null, int batch = 200)
        => new OfferEmailService(
                h.Db, h.Clock, h.Email, new OfferSettings { PostalAddress = PostalAddress, BatchSize = batch },
                new HmacEmailUnsubscribeTokens(h.Keys), quota: quota)
            .RunAsync(default);

    private static OfferEmail Row(TestHarness h, User user) => h.Db.OfferEmails.AsNoTracking().Single(e => e.UserId == user.Id);

    private static OfferSkipReason? Reason(TestHarness h, User user)
    {
        var row = Row(h, user);
        Assert.Equal(OfferEmailStatus.Skipped, row.Status);
        return row.SkipReason;
    }
}
