using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Offers;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// The offer email as board P1 draws it (header line, greeting, the price box in the person's set, the ticks, the
/// button, the end in their own time, the marketing footer with the postal address), its headers, its plain-text twin,
/// and the sender's quota rules: optional mail held by the quota, an admin's test always sent.
/// </summary>
public class OfferEmailTemplateTests
{
    private const string Unsubscribe = "https://api.notefusion.studio/api/email/unsubscribe?token=abc";

    [Fact]
    public void The_Halloween_email_carries_the_boards_words_prices_and_footer()
    {
        var message = Template(PostalAddress).Offer(new EmailRecipient("grace@example.com", "Grace Hopper"), Content(Standard()));

        Assert.Equal("30% off Pro, until Halloween", message.Subject);
        var html = message.HtmlBody;
        Assert.Contains("https://notefusion.studio/email/season-halloween.png", html);
        Assert.Contains("Halloween offer &nbsp;·&nbsp; until 31 October", html);
        Assert.Contains("Pro is 30% off until Halloween</h1>", html);
        Assert.Contains("Hello Grace,", html);
        Assert.Contains("For the rest of October, Pro is <strong style=\"color:#0f172a\">30% off</strong>, monthly or yearly.", html);
        Assert.Contains("Halloween offer &nbsp;·&nbsp; 30% off Pro", html);
        foreach (var price in new[] { "$9.99", "$6.99", "$79", "$55", "$4.58 a month", "for one month" })
            Assert.Contains(price, html);
        Assert.Contains("Learn my part</em> to rehearse yours", html);
        Assert.Contains(">Get 30% off Pro</a>", html);
        Assert.Contains("href=\"https://notefusion.studio/app?offer=halloween-2026&amp;m=tok_123\"", html);
        Assert.Contains("The offer ends at midnight on Saturday 31 October, your time. Each payment buys one month or one year of Pro; nothing renews by itself.", html);
        Assert.Contains("email from us is switched on", html);
        Assert.Contains($"href=\"{Unsubscribe}\"", html);
        Assert.Contains("NoteFusion &nbsp;·&nbsp; NoteFusion Ltd, 1 Example Street, London N1 1AA", html);
        Assert.Contains("prefers-color-scheme: dark", html);
        Assert.Contains("#EDE6CF", html);

        Assert.Equal("hello@notefusion.studio", message.ReplyTo);
        Assert.Null(message.FromName); // "NoteFusion", the sender's own name
        Assert.Equal($"<{Unsubscribe}>", message.Headers!["List-Unsubscribe"]);
        Assert.Equal("List-Unsubscribe=One-Click", message.Headers["List-Unsubscribe-Post"]);

        Assert.Contains("Pro Monthly: $6.99 for one month (was $9.99)", message.TextBody);
        Assert.Contains("Pro Yearly: $55 for one year (was $79), $4.58 a month", message.TextBody);
        Assert.Contains("Get 30% off Pro: https://notefusion.studio/app?offer=halloween-2026&m=tok_123", message.TextBody);
        Assert.Contains($"Unsubscribe: {Unsubscribe}", message.TextBody);
        Assert.Contains("NoteFusion · NoteFusion Ltd, 1 Example Street, London N1 1AA", message.TextBody);
    }

    [Fact]
    public void The_Christmas_skin_changes_the_art_and_colours_and_the_regional_set_its_prices()
    {
        var content = Content(
            [new OfferEmailPrice("Pro Monthly", BillingInterval.Monthly, 499, 349), new OfferEmailPrice("Pro Yearly", BillingInterval.Yearly, 3_999, 2_799)],
            template: OfferTemplates.ChristmasTemplate, lastDay: new DateOnly(2026, 12, 26));

        var rendered = Template(PostalAddress).RenderOffer(new EmailRecipient("kofi@example.com", null), content);

        Assert.Equal("30% off Pro for Christmas", rendered.Subject);
        Assert.Equal("Whole songs, four parts and Sing it back, monthly or yearly, until 26 December.", rendered.Preheader);
        Assert.Contains("season-christmas.png", rendered.Html);
        Assert.Contains("Christmas offer &nbsp;·&nbsp; until 26 December", rendered.Html);
        Assert.Contains("#F3DFB4", rendered.Html);
        Assert.DoesNotContain("#EDE6CF", rendered.Html);
        Assert.Contains("Hello,", rendered.Html);
        Assert.Contains("$27.99", rendered.Html);
        Assert.Contains("$2.33 a month", rendered.Html);
        Assert.Contains("midnight on Saturday 26 December", rendered.Html);
    }

    [Fact]
    public void Without_a_postal_address_the_footer_says_where_it_goes()
    {
        var html = Template("").RenderOffer(new EmailRecipient("grace@example.com", "Grace"), Content(Standard())).Html;
        Assert.Contains(BrandedEmailTemplate.PostalAddressPlaceholder.Replace("'", "&#39;"), html);
    }

    [Fact]
    public void An_offer_of_one_plan_says_what_one_payment_buys()
    {
        var monthly = Content([new OfferEmailPrice("Pro Monthly", BillingInterval.Monthly, 999, 699)]);
        var html = Template(PostalAddress).RenderOffer(new EmailRecipient("grace@example.com", "Grace"), monthly).Html;
        Assert.Contains("Each payment buys one month of Pro;", html);
        Assert.DoesNotContain("Pro Yearly", html);
    }

    [Fact]
    public async Task An_offer_email_waits_for_the_quota_but_an_admins_test_always_goes()
    {
        var transport = new RecordingTransport();
        var sender = new EmailSender(Template(PostalAddress), transport, NullLogger<EmailSender>.Instance, new NoRoom());

        var held = await sender.SendOfferAsync(new EmailRecipient("grace@example.com", "Grace"), Content(Standard()));
        Assert.True(EmailBudget.IsHeld(held.Error));
        Assert.Empty(transport.Sent);

        var quota = new CountingQuota();
        var counted = new EmailSender(Template(PostalAddress), transport, NullLogger<EmailSender>.Instance, quota);
        Assert.True((await counted.SendOfferAsync(new EmailRecipient("grace@example.com", "Grace"), Content(Standard()))).IsSuccess);
        Assert.True((await sender.SendOfferAsync(new EmailRecipient("francis@notefusion.studio", "Francis"), Content(Standard()), test: true)).IsSuccess);
        Assert.Equal(2, transport.Sent.Count);
        Assert.Equal([EmailKind.Offer], quota.Recorded);
    }

    [Fact]
    public void The_settings_read_the_switch_and_the_postal_address_from_the_environment()
    {
        var blank = OffersDependencyInjection.ResolveSettings(Config(("Offers:Enabled", ""), ("Email:PostalAddress", "")));
        Assert.True(blank.Enabled);
        Assert.False(blank.PostalAddressSet);
        Assert.Equal((200, 5), (blank.BatchSize, blank.IntervalMinutes));

        var set = OffersDependencyInjection.ResolveSettings(Config(
            ("Offers:Enabled", "false"), ("Email:PostalAddress", " NoteFusion Ltd, London "), ("Outreach:ApiBaseUrl", "https://api.example.com")));
        Assert.False(set.Enabled);
        Assert.Equal("NoteFusion Ltd, London", set.PostalAddress);
        Assert.Equal("https://api.example.com", set.ApiBaseUrl);
        Assert.Equal("NoteFusion Ltd, London", EmailSettings.Resolve(Config(("Email:PostalAddress", "NoteFusion Ltd, London"))).PostalAddress);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static BrandedEmailTemplate Template(string postal) => new(new EmailSettings { PostalAddress = postal });

    private static IReadOnlyList<OfferEmailPrice> Standard()
        => [new("Pro Monthly", BillingInterval.Monthly, 999, 699), new("Pro Yearly", BillingInterval.Yearly, 7_900, 5_500)];

    private static OfferEmailContent Content(IReadOnlyList<OfferEmailPrice> prices, OfferTemplate? template = null, DateOnly? lastDay = null)
    {
        template ??= OfferTemplates.HalloweenTemplate;
        var day = lastDay ?? LastDay;
        return new OfferEmailContent(
            $"{template.Template}-{day.Year}", template.Template, template.Label, 30, template.Words, day, prices,
            $"https://notefusion.studio/app?offer={template.Template}-{day.Year}&m=tok_123", Unsubscribe);
    }

    private static IConfiguration Config(params (string Key, string Value)[] pairs)
        => new ConfigurationBuilder().AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value)).Build();

    private sealed class RecordingTransport : IEmailTransport
    {
        public List<EmailMessage> Sent { get; } = [];

        public Task SendAsync(EmailMessage message, CancellationToken ct)
        {
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    private sealed class CountingQuota : IEmailQuota
    {
        public List<EmailKind> Recorded { get; } = [];

        public Task<bool> AllowsOptionalAsync(EmailKind kind, CancellationToken ct) => Task.FromResult(true);

        public Task RecordSentAsync(EmailKind kind)
        {
            Recorded.Add(kind);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<EmailWindowUsage>> ReadUsageAsync(CancellationToken ct)
            => Task.FromResult<IReadOnlyList<EmailWindowUsage>>([]);
    }
}
