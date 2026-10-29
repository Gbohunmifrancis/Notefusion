using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Application.Offers.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// An offer's last call: the follow-up before it ends, to the groups its email went to less those who bought, never
/// both emails at once; its own words, a live countdown to each person's own midnight, the usual price after it; and
/// the console's list of who opened which email.
/// </summary>
public class OfferLastCallTests
{
    /// <summary>Fri 30 Oct 10:00 UTC: the day before the Halloween offer's last day, inside London's sending hours.</summary>
    private static readonly DateTime Friday = new(2026, 10, 30, 10, 0, 0, DateTimeKind.Utc);

    // ── Sending it ───────────────────────────────────────────────────────────

    [Fact]
    public async Task The_last_call_goes_to_the_emails_groups_less_buyers_instead_of_any_email_still_waiting()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var opened = Account(h, "opened@example.com", "US");
        var waiting = Account(h, "waiting@example.com", "US");
        var buyer = Account(h, "buyer@example.com", "US");
        Assert.True((await Send(h, admin, offer.Id)).IsSuccess);
        foreach (var row in h.Db.OfferEmails.Where(e => e.UserId != waiting.Id))
            row.MarkSent(Midweek);
        h.Db.SaveChanges();
        Payment(h, buyer, plans.Monthly, 699, offer.Id, Midweek.AddHours(2));
        var newcomer = Account(h, "newcomer@example.com", "CA");
        h.Clock.UtcNow = Friday;

        var sent = await LastCall(h, admin, offer.Id);

        Assert.True(sent.IsSuccess);
        Assert.Equal(Friday, sent.Value.LastCallStartedAtUtc);
        Assert.Equal(OfferTemplates.HalloweenTemplate.LastCallWords, sent.Value.LastCallWords);
        var lastCalls = h.Db.OfferEmails.AsNoTracking().Where(e => e.Round == OfferEmailRound.LastCall).ToList();
        Assert.Equal(
            new[] { admin.Id, opened.Id, waiting.Id, newcomer.Id }.Order(),
            lastCalls.Select(e => e.UserId).Order());
        Assert.All(lastCalls, e => Assert.Equal(OfferEmailStatus.Queued, e.Status));
        // Its own tokens, never the email's.
        var launchTokens = h.Db.OfferEmails.Where(e => e.Round == OfferEmailRound.Launch).Select(e => e.Token).ToHashSet();
        Assert.DoesNotContain(lastCalls, e => launchTokens.Contains(e.Token));
        // Waiting for the email still: the last call goes instead.
        var stillWaiting = h.Db.OfferEmails.AsNoTracking().Single(e => e.UserId == waiting.Id && e.Round == OfferEmailRound.Launch);
        Assert.Equal((OfferEmailStatus.Skipped, OfferSkipReason.LastCallInstead), (stillWaiting.Status, stillWaiting.SkipReason));
        Assert.Equal(
            "Sent the Halloween 2026 offer's last call to 4 people (free accounts and lapsed Pro).",
            h.Db.AdminAuditLogs.Single(a => a.Action == AdminAuditAction.SendOfferLastCall).Summary);

        Assert.Equal("OFFER_LAST_CALL_SENT", (await LastCall(h, admin, offer.Id)).Error.Code);
        var words = new OfferWords("New", "New", "New", "New");
        Assert.Equal("OFFER_LAST_CALL_WORDS_LOCKED", (await Update(h, admin, new UpdateOfferCommand(offer.Id, LastCallWords: words))).Error.Code);
    }

    [Fact]
    public async Task The_last_call_follows_the_email_and_is_refused_as_Send_is()
    {
        using var h = new TestHarness(Friday);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);

        Assert.Equal("OFFER_LAST_CALL_BEFORE_SEND", (await LastCall(h, admin, offer.Id)).Error.Code);
        Assert.True((await Send(h, admin, offer.Id)).IsSuccess);
        Assert.Equal("OFFER_POSTAL_ADDRESS_MISSING", (await LastCall(h, admin, offer.Id, Settings(postal: ""))).Error.Code);
        h.Clock.UtcNow = offer.LatestEndUtc;
        Assert.Equal("OFFER_ENDED", (await LastCall(h, admin, offer.Id)).Error.Code);
        Assert.DoesNotContain(h.Db.OfferEmails, e => e.Round == OfferEmailRound.LastCall);
    }

    [Fact]
    public async Task Its_words_are_the_templates_until_changed_and_lock_once_sent()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        Assert.Equal(OfferTemplates.HalloweenTemplate.LastCallWords, (await List(h)).Single().LastCallWords);

        var mine = new OfferWords("Only hours left: {pct}% off", "Ends tonight.", "Tick tock, {pct}% off", "Last chance.");
        var changed = await Update(h, admin, new UpdateOfferCommand(offer.Id, LastCallWords: mine));
        Assert.Equal(mine, changed.Value.LastCallWords);
        Assert.Contains("changed the last call's words", h.Db.AdminAuditLogs.Single(a => a.Action == AdminAuditAction.UpdateOffer).Summary);
        Assert.Equal("OFFER_WORDS_INVALID", (await Update(h, admin, new UpdateOfferCommand(offer.Id, LastCallWords: mine with { Body = "" }))).Error.Code);
    }

    // ── What goes out ────────────────────────────────────────────────────────

    [Fact]
    public async Task The_worker_sends_the_last_call_first_with_its_words_its_own_link_and_a_countdown_to_the_persons_end()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        Account(h, "grace@example.com", "GB");
        await Send(h, admin, offer.Id);
        h.Clock.UtcNow = Friday;
        await LastCall(h, admin, offer.Id);

        await new OfferEmailService(
                h.Db, h.Clock, h.Email, new OfferSettings { PostalAddress = PostalAddress, BatchSize = 200 },
                new HmacEmailUnsubscribeTokens(h.Keys))
            .RunAsync(default);

        var grace = h.Db.Users.Single(u => u.Email == "grace@example.com");
        var row = h.Db.OfferEmails.AsNoTracking().Single(e => e.UserId == grace.Id && e.Round == OfferEmailRound.LastCall);
        Assert.Equal(OfferEmailStatus.Sent, row.Status);
        var (_, email, test) = h.Email.Offers.Single(o => o.To.Email == "grace@example.com");
        Assert.False(test);
        Assert.True(email.LastCall);
        Assert.Equal(OfferTemplates.HalloweenTemplate.LastCallWords, email.Words);
        Assert.Equal($"https://api.notefusion.studio/api/offers/countdown?o=halloween-2026&m={row.Token}", email.CountdownUrl);
        Assert.Equal($"https://api.notefusion.studio/api/offers/o/{row.Token}", email.OpenPixelUrl);
        Assert.EndsWith($"&m={row.Token}", email.OfferUrl);
    }

    [Fact]
    public void The_last_calls_email_shows_the_countdown_says_when_it_ends_and_the_usual_price_after()
    {
        var content = new OfferEmailContent(
            "halloween-2026", OfferTemplates.Halloween, "Halloween offer", 30, OfferTemplates.HalloweenTemplate.LastCallWords, LastDay,
            [new("Pro Monthly", BillingInterval.Monthly, 999, 699), new("Pro Yearly", BillingInterval.Yearly, 7_900, 5_500)],
            "https://notefusion.studio/app?offer=halloween-2026&m=tok_123", "https://api.notefusion.studio/api/email/unsubscribe?token=abc",
            "https://api.notefusion.studio/api/offers/o/tok_123", LastCall: true,
            CountdownUrl: "https://api.notefusion.studio/api/offers/countdown?o=halloween-2026&m=tok_123");

        var message = new BrandedEmailTemplate(new EmailSettings { PostalAddress = PostalAddress })
            .Offer(new EmailRecipient("grace@example.com", "Grace Hopper"), content);

        Assert.Equal("🎃 Last call: 30% off Pro is almost gone", message.Subject);
        var html = message.HtmlBody;
        Assert.Contains("Halloween offer &nbsp;·&nbsp; ends 31 October", html);
        Assert.Contains("Midnight is coming for your 30% off</h1>", html);
        Assert.Contains("src=\"https://api.notefusion.studio/api/offers/countdown?o=halloween-2026&amp;m=tok_123\"", html);
        Assert.Contains("alt=\"Ends at midnight on Saturday 31 October, your time\"", html);
        Assert.Contains("The offer ends in", html);
        Assert.Contains("Pro goes back to its usual price of $9.99 a month or $79 a year.", html);
        Assert.Contains(">Get 30% off before midnight</a>", html);
        Assert.Contains("Ends at midnight on Saturday 31 October, your time.", message.TextBody);

        // The email itself shows no countdown.
        var launch = new BrandedEmailTemplate(new EmailSettings { PostalAddress = PostalAddress })
            .Offer(new EmailRecipient("grace@example.com", "Grace Hopper"), content with { LastCall = false, CountdownUrl = null, Words = OfferTemplates.HalloweenTemplate.Words });
        Assert.DoesNotContain("countdown", launch.HtmlBody);
        Assert.Contains("until 31 October", launch.HtmlBody);
    }

    [Fact]
    public async Task A_preview_and_a_test_of_the_last_call_count_down_to_the_UKs_midnight()
    {
        using var h = new TestHarness(Friday);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);

        var preview = (await Queries(h).Handle(new PreviewOfferEmailQuery(offer.Id, Round: "lastCall"), default)).Value;
        Assert.StartsWith("🎃 Last call", preview.Subject);
        Assert.Contains("api/offers/countdown?o=halloween-2026\"", preview.Html);
        Assert.Equal("OFFER_ROUND_UNKNOWN", (await Queries(h).Handle(new PreviewOfferEmailQuery(offer.Id, Round: "third"), default)).Error.Code);

        await new SendOfferTestCommandHandler(
                h.Db, new StubCurrentUser(admin.Id, UserRole.Admin, admin.Email), h.Email, new HmacEmailUnsubscribeTokens(h.Keys),
                h.AuditAs(admin), Settings())
            .Handle(new SendOfferTestCommand(offer.Id, null, "lastCall"), default);
        var (_, email, isTest) = Assert.Single(h.Email.Offers);
        Assert.True(isTest && email.LastCall);
        Assert.Equal("https://api.notefusion.studio/api/offers/countdown?o=halloween-2026", email.CountdownUrl);
        Assert.Null(email.OpenPixelUrl);
    }

    // ── The countdown ────────────────────────────────────────────────────────

    [Fact]
    public async Task The_countdown_counts_to_the_persons_own_midnight_or_the_UKs_and_to_nothing_once_over()
    {
        using var h = new TestHarness(Friday);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        Account(h, "lagos@example.com", "US", zone: "Africa/Lagos");
        await Send(h, admin, offer.Id);
        await LastCall(h, admin, offer.Id);
        var lagos = h.Db.Users.Single(u => u.Email == "lagos@example.com");
        var token = h.Db.OfferEmails.Single(e => e.UserId == lagos.Id && e.Round == OfferEmailRound.LastCall).Token;
        var query = new GetOfferCountdownQueryHandler(h.Db, h.Clock);

        // Lagos is UTC+1: midnight after Sat 31 Oct is 23:00 UTC that day, 37 hours from Friday 10:00 UTC.
        Assert.Equal(TimeSpan.FromHours(37), (await query.Handle(new GetOfferCountdownQuery("halloween-2026", token), default)).Value.Left);
        // London is on GMT by then: midnight is 00:00 UTC on 1 November.
        Assert.Equal(TimeSpan.FromHours(38), (await query.Handle(new GetOfferCountdownQuery("halloween-2026", null), default)).Value.Left);
        Assert.Equal(TimeSpan.FromHours(38), (await query.Handle(new GetOfferCountdownQuery("halloween-2026", "not-a-real-token-at-all"), default)).Value.Left);
        Assert.Equal(TimeSpan.Zero, (await query.Handle(new GetOfferCountdownQuery("no-such-offer", null), default)).Value.Left);
        h.Clock.UtcNow = offer.LatestEndUtc;
        Assert.Equal(TimeSpan.Zero, (await query.Handle(new GetOfferCountdownQuery("halloween-2026", token), default)).Value.Left);
    }

    [Fact]
    public void The_countdown_splits_the_time_left_into_days_hours_minutes_and_seconds()
    {
        Assert.Equal((1, 13, 5, 9), OfferCountdown.Parts(86_400 + 13 * 3600 + 5 * 60 + 9));
        Assert.Equal((0, 0, 0, 0), OfferCountdown.Parts(-5));
        Assert.Equal((99, 0, 0, 0), OfferCountdown.Parts(200L * 86_400));
    }

    [Fact]
    public void The_countdown_is_a_minute_of_frames_one_a_second_played_once_and_small()
    {
        var gif = OfferCountdown.Render(TimeSpan.FromHours(37).Add(TimeSpan.FromSeconds(30)), OfferCountdown.Halloween);
        var decoded = GifReader.Read(gif);

        Assert.Equal((OfferCountdown.Width, OfferCountdown.Height), (decoded.Width, decoded.Height));
        Assert.Equal(OfferCountdown.Frames, decoded.Frames.Count);
        Assert.All(decoded.Frames, f => Assert.Equal(100, f.DelayCentiseconds));
        Assert.False(decoded.Loops);
        Assert.True(gif.Length < 60_000, $"{gif.Length} bytes");
        // Every frame shows the four colours' worth: the night, the boxes, the digits and the labels.
        Assert.Equal(new[] { 0, 1, 2, 3 }, decoded.Frames[0].Pixels.Distinct().Select(p => (int)p).Order());
        // The seconds tick: each frame differs from the one before, the first frame is whole.
        Assert.Equal((0, 0, OfferCountdown.Width, OfferCountdown.Height), decoded.Frames[0].Rect);
        for (var i = 1; i < decoded.Frames.Count; i++)
            Assert.False(decoded.Frames[i].Pixels.SequenceEqual(decoded.Frames[i - 1].Pixels), $"frame {i}");
        // Drawn again from the same moment, the same picture: frame 30 of one is frame 0 of a clock 30 s later.
        var later = GifReader.Read(OfferCountdown.Render(TimeSpan.FromHours(37), OfferCountdown.Halloween));
        Assert.Equal(decoded.Frames[30].Pixels, later.Frames[0].Pixels);

        // Over: one frame at nothing.
        Assert.Single(GifReader.Read(OfferCountdown.Render(TimeSpan.FromSeconds(-3), OfferCountdown.Christmas)).Frames);
        // Under a minute left: a frame a second down to nothing, and no further.
        Assert.Equal(6, GifReader.Read(OfferCountdown.Render(TimeSpan.FromSeconds(5.5), OfferCountdown.Halloween)).Frames.Count);
    }

    // ── Who opened ───────────────────────────────────────────────────────────

    [Fact]
    public async Task The_console_lists_who_opened_each_email_with_what_came_of_it()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var grace = Account(h, "grace@example.com", "GB", name: "Grace Hopper");
        var kofi = Account(h, "kofi@example.com", "GH", name: "Kofi Mensah");
        Account(h, "quiet@example.com", "US", name: "Quiet One");
        await Send(h, admin, offer.Id);
        foreach (var row in h.Db.OfferEmails)
            row.MarkSent(Midweek);
        h.Db.SaveChanges();
        h.Clock.UtcNow = Friday;
        await LastCall(h, admin, offer.Id);
        foreach (var row in h.Db.OfferEmails.Where(e => e.Round == OfferEmailRound.LastCall))
            row.MarkSent(Friday);
        h.Db.SaveChanges();

        string Token(User u, OfferEmailRound round) => h.Db.OfferEmails.Single(e => e.UserId == u.Id && e.Round == round).Token;
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Midweek.AddHours(1))).Handle(new RecordOfferOpenCommand(Token(grace, OfferEmailRound.Launch)), default);
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Friday.AddHours(1))).Handle(new RecordOfferOpenCommand(Token(kofi, OfferEmailRound.LastCall)), default);
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Friday.AddHours(2))).Handle(new RecordOfferOpenCommand(Token(grace, OfferEmailRound.LastCall)), default);
        await new RecordOfferClickCommandHandler(h.Db, new FixedClock(Friday.AddHours(3))).Handle(new RecordOfferClickCommand(Token(kofi, OfferEmailRound.LastCall)), default);
        Payment(h, kofi, plans.RegionalMonthly, 349, offer.Id, Friday.AddHours(4));
        var recipients = new GetOfferRecipientsQueryHandler(h.Db);

        var lastCall = (await recipients.Handle(new GetOfferRecipientsQuery(offer.Id, "lastCall"), default)).Value;
        Assert.Equal(("lastCall", "opened", 2, 2), (lastCall.Round, lastCall.Filter, lastCall.Total, lastCall.Opened));
        Assert.Equal(new[] { "Grace Hopper", "Kofi Mensah" }, lastCall.Items.Select(r => r.Name)); // the newest open first
        var k = lastCall.Items[1];
        Assert.Equal(("kofi@example.com", "GH", "Sent"), (k.Email, k.Country, k.Status));
        Assert.Equal((Friday.AddHours(1), Friday.AddHours(3), Friday.AddHours(4)), (k.OpenedAtUtc!.Value, k.ClickedAtUtc!.Value, k.BoughtAtUtc!.Value));

        var launch = (await recipients.Handle(new GetOfferRecipientsQuery(offer.Id, "launch"), default)).Value;
        Assert.Equal("grace@example.com", Assert.Single(launch.Items).Email);
        Assert.Equal(4, (await recipients.Handle(new GetOfferRecipientsQuery(offer.Id, "launch", "all"), default)).Value.Total);
        Assert.Equal("kofi@example.com", Assert.Single((await recipients.Handle(new GetOfferRecipientsQuery(offer.Id, "lastCall", "bought"), default)).Value.Items).Email);
        Assert.Equal("OFFER_FILTER_UNKNOWN", (await recipients.Handle(new GetOfferRecipientsQuery(offer.Id, "launch", "everyone"), default)).Error.Code);

        // The progress keeps the email's counts and gives the last call its own.
        var progress = (await Queries(h).Handle(new GetOfferProgressQuery(offer.Id), default)).Value;
        Assert.Equal((4, 1), (progress.Sent, progress.Opened));
        Assert.Equal(new OfferLastCallProgressDto(0, 4, 0, 0, 2, 1, 1), progress.LastCall);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static StubCurrentUser Caller(User admin) => new(admin.Id, UserRole.Admin, admin.Email, admin.FullName);

    private static Task<Result<AdminOfferDto>> Send(TestHarness h, User admin, Guid id)
        => new SendOfferCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, Settings())
            .Handle(new SendOfferCommand(id, true, true, false), default);

    private static Task<Result<AdminOfferDto>> LastCall(TestHarness h, User admin, Guid id, OfferSettings? settings = null)
        => new SendOfferLastCallCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, settings ?? Settings())
            .Handle(new SendOfferLastCallCommand(id), default);

    private static Task<Result<AdminOfferDto>> Update(TestHarness h, User admin, UpdateOfferCommand command)
        => new UpdateOfferCommandHandler(h.Db, h.AuditAs(admin), h.Clock, Settings()).Handle(command, default);

    private static async Task<IReadOnlyList<AdminOfferDto>> List(TestHarness h)
        => (await Queries(h).Handle(new GetAdminOffersQuery(), default)).Value;

    private static AdminOfferQueryHandlers Queries(TestHarness h)
        => new(h.Db, h.Clock, Settings(),
            new OfferEmailRenderer(new BrandedEmailTemplate(new EmailSettings { PostalAddress = PostalAddress })),
            new EmailQuotaSettings());

    /// <summary>A plain GIF reader for the test: frames with their rectangles, delays and the whole picture after each.</summary>
    private static class GifReader
    {
        public sealed record Frame(byte[] Pixels, (int X, int Y, int W, int H) Rect, int DelayCentiseconds);

        public sealed record Gif(int Width, int Height, bool Loops, IReadOnlyList<Frame> Frames);

        public static Gif Read(byte[] data)
        {
            Assert.Equal("GIF89a", System.Text.Encoding.ASCII.GetString(data, 0, 6));
            var at = 6;
            int U16() { var v = data[at] | data[at + 1] << 8; at += 2; return v; }
            var width = U16();
            var height = U16();
            var packed = data[at++];
            at += 2;
            if ((packed & 0x80) != 0)
                at += 3 * (1 << ((packed & 7) + 1));

            var canvas = new byte[width * height];
            var frames = new List<Frame>();
            var loops = false;
            var delay = 0;
            while (true)
            {
                var block = data[at++];
                if (block == 0x3B)
                    break;
                if (block == 0x21)
                {
                    var label = data[at++];
                    var first = true;
                    while (data[at] != 0)
                    {
                        var size = data[at++];
                        if (label == 0xF9 && first)
                            delay = data[at + 1] | data[at + 2] << 8;
                        if (label == 0xFF && first && System.Text.Encoding.ASCII.GetString(data, at, 8) == "NETSCAPE")
                            loops = true;
                        at += size;
                        first = false;
                    }
                    at++;
                    continue;
                }
                Assert.Equal(0x2C, block);
                var (x, y, w, h) = (U16(), U16(), U16(), U16());
                Assert.Equal(0, data[at++] & 0x80); // no local colour table
                var minCode = data[at++];
                var lzw = new List<byte>();
                while (data[at] != 0)
                {
                    var size = data[at++];
                    lzw.AddRange(data.AsSpan(at, size).ToArray());
                    at += size;
                }
                at++;
                var region = Decode([.. lzw], minCode, w * h);
                for (var row = 0; row < h; row++)
                    Array.Copy(region, row * w, canvas, (y + row) * width + x, w);
                frames.Add(new Frame((byte[])canvas.Clone(), (x, y, w, h), delay));
            }
            return new Gif(width, height, loops, frames);
        }

        private static byte[] Decode(byte[] data, int minCode, int count)
        {
            var clear = 1 << minCode;
            var end = clear + 1;
            var output = new List<byte>(count);
            var table = new List<byte[]>();
            void Reset()
            {
                table.Clear();
                for (var i = 0; i < clear; i++) table.Add([(byte)i]);
                table.Add([]);
                table.Add([]);
            }
            Reset();
            var size = minCode + 1;
            var bitPos = 0;
            byte[]? previous = null;
            while (true)
            {
                var code = 0;
                for (var b = 0; b < size; b++, bitPos++)
                    code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << b;
                if (code == clear)
                {
                    Reset();
                    size = minCode + 1;
                    previous = null;
                    continue;
                }
                if (code == end)
                    break;
                byte[] entry;
                if (code < table.Count)
                    entry = table[code];
                else
                {
                    Assert.Equal(table.Count, code);
                    entry = [.. previous!, previous![0]];
                }
                output.AddRange(entry);
                if (previous is not null && table.Count < 4096)
                    table.Add([.. previous, entry[0]]);
                if (table.Count == 1 << size && size < 12)
                    size++;
                previous = entry;
            }
            Assert.Equal(count, output.Count);
            return [.. output];
        }
    }
}
