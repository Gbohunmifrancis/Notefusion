using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Inbox.Sent;
using NoteFusion.Infrastructure.Email;

namespace NoteFusion.Tests.Inbox;

/// <summary>
/// The console's Sent mail: what the app sent, read from Resend's log, with every sign-in code masked and the body of an
/// email holding a code or a one-time link kept back.
/// </summary>
public class SentMailTests
{
    private static readonly BrandedEmailTemplate Template = new(new EmailSettings { AppUrl = "https://notefusion.studio" });
    private static readonly EmailRecipient Ada = new("ada@example.com", "Ada");

    [Fact]
    public void Codes_and_one_time_links_are_recognised_from_the_templates_own_subjects()
    {
        var verify = Template.VerifyEmail(Ada, "482913").Subject;
        var admin = Template.AdminCode(Ada, "771204", setup: false).Subject;
        var reset = Template.PasswordReset(Ada, "https://notefusion.studio/reset?token=secret").Subject;

        Assert.Equal("•••••• is your NoteFusion verification code", SentMailPrivacy.Subject(verify));
        Assert.Equal("•••••• is your NoteFusion Admin code", SentMailPrivacy.Subject(admin));
        Assert.All([verify, admin, reset, SentMailPrivacy.DeletionConfirmSubject], s => Assert.True(SentMailPrivacy.HidesBody(s), s));

        var welcome = Template.Welcome(Ada).Subject;
        Assert.Equal(welcome, SentMailPrivacy.Subject(welcome));
        Assert.False(SentMailPrivacy.HidesBody(welcome));
        Assert.False(SentMailPrivacy.HidesBody("Re: my verification code never came"));
    }

    [Fact]
    public async Task The_list_masks_codes_and_a_code_email_opens_without_its_body()
    {
        var code = Guid.NewGuid();
        var receipt = Guid.NewGuid();
        var at = new DateTime(2026, 10, 22, 9, 0, 0, DateTimeKind.Utc);
        var stub = new StubSentMail
        {
            Items =
            [
                new SentMailSummary(code, "482913 is your NoteFusion verification code", "NoteFusion <hello@notefusion.studio>", "ada@example.com", at, "delivered"),
                new SentMailSummary(receipt, "Your NoteFusion receipt — $9.99", "NoteFusion <hello@notefusion.studio>", "ada@example.com", at, "opened"),
            ],
            Full =
            {
                [code] = new SentMail(code, "482913 is your NoteFusion verification code", "NoteFusion", "ada@example.com", at, "delivered", "<p>482913</p>", "482913"),
                [receipt] = new SentMail(receipt, "Your NoteFusion receipt — $9.99", "NoteFusion", "ada@example.com", at, "opened", "<p>Thanks</p>", "Thanks"),
            },
        };

        var page = (await new GetSentMailQueryHandler(stub).Handle(new GetSentMailQuery(1, 50), default)).Value;
        Assert.Equal(["•••••• is your NoteFusion verification code", "Your NoteFusion receipt — $9.99"], page.Items.Select(i => i.Subject));
        Assert.Equal(["delivered", "opened"], page.Items.Select(i => i.Status));

        var hidden = (await new GetSentEmailQueryHandler(stub).Handle(new GetSentEmailQuery(code), default)).Value;
        Assert.Equal((true, (string?)null, (string?)null), (hidden.BodyWithheld, hidden.HtmlBody, hidden.TextBody));
        Assert.DoesNotContain("482913", hidden.Subject);

        var shown = (await new GetSentEmailQueryHandler(stub).Handle(new GetSentEmailQuery(receipt), default)).Value;
        Assert.Equal((false, "<p>Thanks</p>"), (shown.BodyWithheld, shown.HtmlBody));
    }

    [Fact]
    public async Task A_provider_that_does_not_answer_is_said_so_and_an_unknown_email_is_not_found()
    {
        var stub = new StubSentMail { Unavailable = true };

        var list = await new GetSentMailQueryHandler(stub).Handle(new GetSentMailQuery(), default);
        var one = await new GetSentEmailQueryHandler(stub).Handle(new GetSentEmailQuery(Guid.NewGuid()), default);

        Assert.Equal("SENT_MAIL_UNAVAILABLE", list.Error.Code);
        Assert.Equal("SENT_MAIL_NOT_FOUND", one.Error.Code);
    }

    [Fact]
    public async Task Resend_s_log_is_read_with_its_own_dates_and_latest_event()
    {
        var id = Guid.NewGuid();
        var json = $$"""
            {"object":"list","has_more":false,"data":[{"id":"{{id}}","message_id":"<1@x>","to":["ada@example.com"],
             "from":"NoteFusion <hello@notefusion.studio>","created_at":"2026-10-22 21:13:42.674981+00","subject":"Welcome to NoteFusion",
             "bcc":null,"cc":null,"reply_to":null,"last_event":"delivered","scheduled_at":null}]}
            """;
        var handler = new OneAnswer(json);
        var service = new ResendSentMailService(
            new EmailSettings { ApiKey = "re_test" }, new HttpClient(handler), NullLogger<ResendSentMailService>.Instance);

        var page = await service.ListAsync(1, 50);

        Assert.Equal("https://api.resend.com/emails?limit=50", handler.Asked);
        var row = Assert.Single(page!.Items);
        Assert.Equal((id, "Welcome to NoteFusion", "ada@example.com", "delivered"), (row.Id, row.Subject, row.To, row.LastEvent));
        Assert.Equal(new DateTime(2026, 10, 22, 21, 13, 42, DateTimeKind.Utc), row.SentAt.AddTicks(-(row.SentAt.Ticks % TimeSpan.TicksPerSecond)));
        Assert.Equal(DateTimeKind.Utc, row.SentAt.Kind);
    }

    [Fact]
    public async Task A_refused_read_is_null_not_an_empty_list()
    {
        var service = new ResendSentMailService(
            new EmailSettings { ApiKey = "re_test" }, new HttpClient(new OneAnswer("{}", HttpStatusCode.Unauthorized)),
            NullLogger<ResendSentMailService>.Instance);

        Assert.Null(await service.ListAsync(1, 50));
        Assert.Null(await service.GetAsync(Guid.NewGuid()));
    }

    private sealed class OneAnswer(string body, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public string? Asked { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Asked = request.RequestUri!.ToString();
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class StubSentMail : ISentMailService
    {
        public bool Unavailable { get; init; }
        public List<SentMailSummary> Items { get; init; } = [];
        public Dictionary<Guid, SentMail> Full { get; } = [];

        public Task<SentMailPage?> ListAsync(int page, int pageSize, CancellationToken ct = default)
            => Task.FromResult(Unavailable ? null : new SentMailPage(Items, false, Items.Count));

        public Task<SentMail?> GetAsync(Guid emailId, CancellationToken ct = default)
            => Task.FromResult(Full.GetValueOrDefault(emailId));
    }
}
