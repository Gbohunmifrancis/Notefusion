using System.Text.RegularExpressions;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The admins' payment push, word for word (board f-admin/08): the amount and plan as the title, who and what as the
/// line; the currency paid, never converted or added across currencies; never a gendered pronoun; title at most 40
/// characters and line at most 90.
/// </summary>
public class PaymentPushCopyTests
{
    private static readonly DateTime PaidAt = new(2026, 10, 18, 17, 42, 0, DateTimeKind.Utc);

    private static PaymentAlertFacts Pro(
        string name = "Ada Obi", long amount = 750_000, string currency = "NGN",
        string plan = "NoteFusion Pro (Monthly)", BillingInterval interval = BillingInterval.Monthly,
        DateTime? until = null, bool first = false, string? country = "NG")
        => new(Guid.NewGuid(), amount, currency, plan, interval, null, name, country, first,
            until ?? new DateTime(2026, 11, 18, 17, 42, 0, DateTimeKind.Utc), PaidAt);

    [Fact]
    public void Pro_in_naira_is_the_amount_and_plan_then_who_and_until_when()
    {
        var words = PaymentPushCopy.Single(Pro(), hideNames: false);

        Assert.Equal("₦7,500 · Pro Monthly", words.Title);
        Assert.Equal("Ada Obi just paid. Pro until Wed 18 Nov.", words.Body);
    }

    [Fact]
    public void Regional_dollars_name_the_country_and_a_fresh_year()
    {
        var words = PaymentPushCopy.Single(
            Pro("Kwame Mensah", 3_999, "USD", "NoteFusion Pro (Yearly)", BillingInterval.Yearly,
                until: PaidAt.AddYears(1), country: "GH"),
            hideNames: false);

        Assert.Equal("$39.99 · Pro Yearly", words.Title);
        Assert.Equal("Kwame Mensah just paid, from Ghana. Pro for a year.", words.Body);
    }

    [Fact]
    public void A_year_stacked_on_time_left_names_the_day_it_runs_to()
    {
        var words = PaymentPushCopy.Single(
            Pro(amount: 6_000_000, plan: "NoteFusion Pro (Yearly)", interval: BillingInterval.Yearly,
                until: new DateTime(2027, 12, 2, 10, 0, 0, DateTimeKind.Utc)),
            hideNames: false);

        Assert.Equal("₦60,000 · Pro Yearly", words.Title);
        Assert.Equal("Ada Obi just paid. Pro until 2 Dec 2027.", words.Body);
    }

    [Fact]
    public void One_song_and_a_choir_say_what_was_bought_without_a_pronoun()
    {
        var song = PaymentPushCopy.Single(
            new PaymentAlertFacts(Guid.NewGuid(), 150_000, "NGN", "One song", BillingInterval.Single, null,
                "Blessing Eze", "NG", false, null, PaidAt),
            hideNames: false);
        Assert.Equal("₦1,500 · One song", song.Title);
        Assert.Equal("Blessing Eze just bought a song.", song.Body);

        var choir = PaymentPushCopy.Single(
            new PaymentAlertFacts(Guid.NewGuid(), 2_500_000, "NGN", "NoteFusion Choir (Monthly)", BillingInterval.Monthly, 25,
                "Grace Adeyemi", "GB", false, null, PaidAt),
            hideNames: false);
        Assert.Equal("₦25,000 · Choir Monthly", choir.Title);
        Assert.Equal("Grace Adeyemi just paid for a choir: 25 seats.", choir.Body);
    }

    [Fact]
    public void A_first_payment_says_so()
    {
        var words = PaymentPushCopy.Single(Pro(first: true), hideNames: false);

        Assert.Equal("₦7,500 · Pro Monthly · first payment", words.Title);
        Assert.Equal("Ada Obi just paid for the first time.", words.Body);
    }

    [Fact]
    public void Several_payments_are_one_summary_with_each_currency_summed_apart()
    {
        var words = PaymentPushCopy.Summary(
        [
            Pro(),
            Pro("Kwame Mensah", 3_999, "USD", "NoteFusion Pro (Yearly)", BillingInterval.Yearly, PaidAt.AddYears(1), country: "GH"),
            new PaymentAlertFacts(Guid.NewGuid(), 150_000, "NGN", "One song", BillingInterval.Single, null,
                "Blessing Eze", "NG", false, null, PaidAt),
        ], hideNames: false);

        Assert.Equal("3 payments · ₦9,000 · $39.99", words.Title);
        Assert.Equal("Ada Obi, Kwame Mensah and Blessing Eze", words.Body);

        var two = PaymentPushCopy.Summary([Pro(), Pro("Kwame Mensah", 3_999, "USD")], hideNames: false);
        Assert.Equal("2 payments · ₦7,500 · $39.99", two.Title);
        Assert.Equal("Ada Obi and Kwame Mensah", two.Body);
    }

    [Fact]
    public void Many_payers_end_in_a_count()
    {
        var payers = new[] { "Ada Obi", "Kwame Mensah", "Blessing Eze", "Tunde Bakare", "Sarah Lee" }
            .Select(n => Pro(n)).ToList();

        var words = PaymentPushCopy.Summary(payers, hideNames: false);

        Assert.Equal("5 payments · ₦37,500", words.Title);
        Assert.Equal("Ada Obi, Kwame Mensah and 3 others", words.Body);
    }

    [Fact]
    public void Names_left_out_keep_the_amount_and_plan_and_say_where_to_look()
    {
        var one = PaymentPushCopy.Single(Pro(), hideNames: true);
        Assert.Equal("₦7,500 · Pro Monthly", one.Title);
        Assert.Equal("Tap to see who paid.", one.Body);

        var several = PaymentPushCopy.Summary([Pro(), Pro("Kwame Mensah")], hideNames: true);
        Assert.Equal("Tap to see who paid.", several.Body);
        Assert.DoesNotContain("Ada", several.Title + several.Body);
    }

    [Fact]
    public void Kobo_and_cents_are_shown_only_when_there_are_some()
    {
        Assert.Equal("₦7,500", PaymentPushCopy.Money(750_000, "NGN"));
        Assert.Equal("₦7,500.50", PaymentPushCopy.Money(750_050, "NGN"));
        Assert.Equal("$0.99", PaymentPushCopy.Money(99, "usd"));
        Assert.Equal("$1,999.00", PaymentPushCopy.Money(199_900, "USD"));
        Assert.Equal("GHS 10.00", PaymentPushCopy.Money(1_000, "GHS"));
    }

    [Fact]
    public void Every_title_and_line_fits_and_none_is_gendered()
    {
        var longName = "Oluwaseyifunmi Adebayo-Ogunleye Abiodun-Williams";
        var cases = new List<PaymentPushWords>();
        foreach (var hide in new[] { false, true })
        {
            foreach (var first in new[] { false, true })
            {
                cases.Add(PaymentPushCopy.Single(Pro(longName, 25_000_000, "NGN", "NoteFusion Choir (Yearly)", BillingInterval.Yearly, first: first), hide));
                cases.Add(PaymentPushCopy.Single(Pro(longName, 19_900, "USD", "NoteFusion Choir (Yearly)", BillingInterval.Yearly, first: first, country: "PH"), hide));
                cases.Add(PaymentPushCopy.Single(Pro(longName, 7_900, "USD", "NoteFusion Pro (Yearly)", BillingInterval.Yearly,
                    until: new DateTime(2028, 1, 1, 0, 0, 0, DateTimeKind.Utc), first: first, country: "CD"), hide));
                cases.Add(PaymentPushCopy.Single(Pro(longName, first: first, until: new DateTime(9999, 12, 31, 0, 0, 0, DateTimeKind.Utc)), hide));
                cases.Add(PaymentPushCopy.Single(new PaymentAlertFacts(Guid.NewGuid(), 199, "USD", "One song", BillingInterval.Single, null,
                    longName, "US", first, null, PaidAt), hide));
            }
            cases.Add(PaymentPushCopy.Summary(Enumerable.Range(0, 12).Select(i => Pro($"{longName} {i}", 25_000_000)).ToList(), hide));
            cases.Add(PaymentPushCopy.Summary([Pro(longName, 25_000_000), Pro(longName + " II", 19_900, "USD")], hide));
        }
        cases.Add(PaymentPushCopy.Test());

        var gendered = new Regex(@"\b(he|she|him|her|his|hers|himself|herself)\b", RegexOptions.IgnoreCase);
        foreach (var words in cases)
        {
            Assert.InRange(words.Title.Length, 1, PaymentPushCopy.TitleMax);
            Assert.InRange(words.Body.Length, 1, PaymentPushCopy.BodyMax);
            Assert.DoesNotMatch(gendered, words.Title + " " + words.Body);
        }
    }

    [Fact]
    public void The_stored_plan_names_shorten_and_lifetime_reads_as_life()
    {
        Assert.Equal("Pro Monthly", PaymentPushCopy.ShortPlan("NoteFusion Pro (Monthly)"));
        Assert.Equal("Choir Yearly", PaymentPushCopy.ShortPlan("NoteFusion Choir (Yearly)"));
        Assert.Equal("One song", PaymentPushCopy.ShortPlan("One song"));
        Assert.Equal("Payment", PaymentPushCopy.ShortPlan(null));

        var life = PaymentPushCopy.Single(Pro(until: new DateTime(9999, 12, 31, 0, 0, 0, DateTimeKind.Utc)), hideNames: false);
        Assert.Equal("Ada Obi just paid. Pro for life.", life.Body);
    }

    [Fact]
    public void The_channel_is_the_sound_and_vibration_chosen_and_quiet_or_muted_is_silent()
    {
        Assert.Equal("payments-v1", PaymentAlertChannels.ChannelFor("chime", vibrate: true));
        Assert.Equal("payments-v1-chime-still", PaymentAlertChannels.ChannelFor("chime", vibrate: false));
        Assert.Equal("payments-v1-phone", PaymentAlertChannels.ChannelFor("phone", vibrate: true));
        Assert.Equal("payments-v1-none-still", PaymentAlertChannels.ChannelFor("none", vibrate: false));
        Assert.Equal(PaymentAlertChannels.Quiet, PaymentAlertChannels.ChannelFor("none", vibrate: false));

        var evening = new DateTime(2026, 10, 18, 17, 42, 0, DateTimeKind.Utc); // 18:42 in Lagos
        var night = new DateTime(2026, 10, 18, 22, 30, 0, DateTimeKind.Utc); // 23:30 in Lagos
        var morning = new DateTime(2026, 10, 19, 6, 0, 0, DateTimeKind.Utc); // 07:00 in Lagos

        Assert.Equal(("payments-v1", "payment.wav"), PaymentAlertChannels.For("chime", true, true, null, null, evening));
        Assert.Equal(("payments-v1-none-still", (string?)null), PaymentAlertChannels.For("chime", true, true, null, null, night));
        Assert.Equal(("payments-v1", "payment.wav"), PaymentAlertChannels.For("chime", true, false, null, null, night));
        Assert.Equal(("payments-v1", "payment.wav"), PaymentAlertChannels.For("chime", true, true, null, null, morning));
        Assert.Equal(("payments-v1-none-still", (string?)null),
            PaymentAlertChannels.For("phone", true, false, evening.AddMinutes(30), null, evening));
        Assert.Equal(("payments-v1-phone", "default"), PaymentAlertChannels.For("phone", true, false, evening.AddMinutes(-1), null, evening));
        // A London admin's 23:30 is quiet; a Lagos one at the same instant is not.
        Assert.True(PaymentAlertChannels.IsQuietHour(new DateTime(2026, 12, 1, 23, 30, 0, DateTimeKind.Utc), "Europe/London"));
        Assert.False(PaymentAlertChannels.IsQuietHour(new DateTime(2026, 12, 1, 20, 30, 0, DateTimeKind.Utc), "Africa/Lagos"));
    }
}
