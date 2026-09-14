using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Inbox.Commands;
using NoteFusion.Application.Inbox.Queries;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Inbox;

public class InboxTests
{
    private sealed class StubResendInboxService : IResendInboxService
    {
        public List<ResendInboxEmailSummary> Summaries { get; set; } = [];
        public int TotalCount { get; set; }
        public Dictionary<Guid, ResendInboxEmail> Emails { get; set; } = [];
        public Dictionary<Guid, List<ResendInboxAttachment>> Attachments { get; set; } = [];

        public Task<ResendInboxPage> ListAsync(int page, int pageSize, CancellationToken ct = default)
            => Task.FromResult(new ResendInboxPage(Summaries, TotalCount));

        public Task<ResendInboxEmail> GetAsync(Guid emailId, CancellationToken ct = default)
        {
            if (Emails.TryGetValue(emailId, out var email))
                return Task.FromResult(email);

            throw new InvalidOperationException("Not found");
        }

        public Task<IReadOnlyList<ResendInboxAttachment>> ListAttachmentsAsync(Guid emailId, CancellationToken ct = default)
        {
            if (Attachments.TryGetValue(emailId, out var atts))
                return Task.FromResult<IReadOnlyList<ResendInboxAttachment>>(atts);

            return Task.FromResult<IReadOnlyList<ResendInboxAttachment>>([]);
        }

        public Task<string> GetAttachmentDownloadUrlAsync(Guid emailId, Guid attachmentId, CancellationToken ct = default)
            => Task.FromResult("https://example.com/download");
    }

    [Fact]
    public async Task GetInboxQuery_returns_paged_results()
    {
        var emailId = Guid.NewGuid();
        var stub = new StubResendInboxService
        {
            TotalCount = 45,
            Summaries =
            [
                new ResendInboxEmailSummary(emailId, "Test Inquiry", "John <john@example.com>", "hello@notefusion.studio", DateTime.UtcNow, false)
            ]
        };

        var handler = new GetInboxQueryHandler(stub);
        var result = await handler.Handle(new GetInboxQuery(1, 25), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(45, result.Value.Total);
        Assert.Equal(2, result.Value.TotalPages);
        Assert.Single(result.Value.Items);
        Assert.Equal("Test Inquiry", result.Value.Items[0].Subject);
    }

    [Fact]
    public async Task GetInboxEmailQuery_returns_email_details()
    {
        var emailId = Guid.NewGuid();
        var stub = new StubResendInboxService
        {
            Emails =
            {
                [emailId] = new ResendInboxEmail(
                    emailId,
                    "Support needed",
                    "Jane <jane@example.com>",
                    "hello@notefusion.studio",
                    DateTime.UtcNow,
                    "<p>Hello</p>",
                    "Hello",
                    false)
            }
        };

        var handler = new GetInboxEmailQueryHandler(stub);
        var result = await handler.Handle(new GetInboxEmailQuery(emailId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Support needed", result.Value.Subject);
        Assert.Equal("<p>Hello</p>", result.Value.HtmlBody);
        Assert.Equal("Hello", result.Value.TextBody);
    }

    [Fact]
    public async Task GetInboxAttachmentsQuery_returns_attachments()
    {
        var emailId = Guid.NewGuid();
        var attId = Guid.NewGuid();
        var stub = new StubResendInboxService
        {
            Attachments =
            {
                [emailId] =
                [
                    new ResendInboxAttachment(attId, "score.musicxml", "application/xml", 1024, "https://example.com/score.musicxml")
                ]
            }
        };

        var handler = new GetInboxAttachmentsQueryHandler(stub);
        var result = await handler.Handle(new GetInboxAttachmentsQuery(emailId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var att = Assert.Single(result.Value);
        Assert.Equal("score.musicxml", att.Filename);
        Assert.Equal(1024, att.SizeBytes);
    }

    [Fact]
    public async Task ReplyToEmailCommand_parses_recipient_and_prefixes_re()
    {
        var emailId = Guid.NewGuid();
        var stub = new StubResendInboxService
        {
            Emails =
            {
                [emailId] = new ResendInboxEmail(
                    emailId,
                    "Question about Solfa export",
                    "Alice Musician <alice@example.com>",
                    "hello@notefusion.studio",
                    DateTime.UtcNow,
                    "<p>How does export work?</p>",
                    "How does export work?",
                    false)
            }
        };

        var emailSender = new RecordingEmailSender();
        var handler = new ReplyToEmailCommandHandler(stub, emailSender);

        var command = new ReplyToEmailCommand(emailId, "Question about Solfa export", "<p>It exports as MusicXML.</p>");
        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);

        var sent = Assert.Single(emailSender.CustomEmails);
        Assert.Equal("alice@example.com", sent.To.Email);
        Assert.Equal("Re: Question about Solfa export", sent.Subject);
        Assert.Equal("<p>It exports as MusicXML.</p>", sent.BodyHtml);
    }

    [Fact]
    public async Task ReplyToEmailCommand_does_not_double_prefix_re()
    {
        var emailId = Guid.NewGuid();
        var stub = new StubResendInboxService
        {
            Emails =
            {
                [emailId] = new ResendInboxEmail(
                    emailId,
                    "Re: Already replied",
                    "bob@example.com",
                    "hello@notefusion.studio",
                    DateTime.UtcNow,
                    null,
                    "Follow up",
                    false)
            }
        };

        var emailSender = new RecordingEmailSender();
        var handler = new ReplyToEmailCommandHandler(stub, emailSender);

        var command = new ReplyToEmailCommand(emailId, "Re: Already replied", "<p>Acknowledged.</p>");
        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);

        var sent = Assert.Single(emailSender.CustomEmails);
        Assert.Equal("bob@example.com", sent.To.Email);
        Assert.Equal("Re: Already replied", sent.Subject);
    }
}
