using NoteFusion.Application.Admin.Inbox;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Transcriptions;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>New mail in the console's Mail is pushed to the admins' consoles: once each, never old mail at a start.</summary>
public class AdminInboxWatchTests
{
    private static readonly DateTime Now = new(2026, 10, 28, 12, 0, 0, DateTimeKind.Utc);

    private sealed class FakeInbox : IResendInboxService
    {
        public List<ResendInboxEmailSummary> Mail { get; } = [];

        public Task<ResendInboxPage> ListAsync(int page, int pageSize, CancellationToken ct = default)
            => Task.FromResult(new ResendInboxPage([.. Mail.OrderByDescending(m => m.ReceivedAt).Take(pageSize)], false, Mail.Count));

        public Task<ResendInboxEmail> GetAsync(Guid emailId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ResendInboxAttachment>> ListAttachmentsAsync(Guid emailId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> GetAttachmentDownloadUrlAsync(Guid emailId, Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();

        public ResendInboxEmailSummary Arrives(string from, string subject, DateTime at)
        {
            var email = new ResendInboxEmailSummary(Guid.NewGuid(), subject, from, "hello@notefusion.studio", at, false);
            Mail.Add(email);
            return email;
        }
    }

    private static void Admin(TestHarness h)
    {
        var admin = User.CreateAdmin("Francis", "francis@notefusion.studio", h.Hasher.Hash("pw"), Now.AddDays(-90));
        h.Db.Users.Add(admin);
        h.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(admin.Id, "https://fcm.googleapis.com/fcm/send/console-1",
            "p", "a", null, Now, WebPushSubscription.ConsoleAudience));
        h.Db.SaveChanges();
    }

    [Fact]
    public async Task The_first_look_only_notes_the_place_and_a_new_email_is_pushed_once()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        var inbox = new FakeInbox();
        inbox.Arrives("Old <old@example.com>", "Before the start", Now.AddHours(-2));
        var events = new InMemoryJobEvents();
        var handler = new WatchAdminInboxCommandHandler(inbox, h.Db, h.WebPush, events);

        var first = await handler.Handle(new WatchAdminInboxCommand(null, new HashSet<Guid>()), default);
        Assert.Empty(first.Told);
        Assert.Empty(h.WebPush.SentToConsole);   // a restart never pushes old mail

        var email = inbox.Arrives("\"Ada Obi\" <ada@example.com>", "Can my choir share one plan?", Now.AddMinutes(1));
        var second = await handler.Handle(new WatchAdminInboxCommand(first.SeenUpTo, new HashSet<Guid>()), default);
        var push = Assert.Single(h.WebPush.SentToConsole).Notification;
        Assert.Equal(("Email · Ada Obi", "Can my choir share one plan?", "/inbox", "email"), (push.Title, push.Body, push.Url, push.Kind));

        var third = await handler.Handle(new WatchAdminInboxCommand(second.SeenUpTo, second.Told.ToHashSet()), default);
        Assert.Empty(third.Told);
        Assert.Single(h.WebPush.SentToConsole);   // not again
    }

    [Fact]
    public async Task Many_new_emails_at_once_are_one_summary()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        var inbox = new FakeInbox();
        var handler = new WatchAdminInboxCommandHandler(inbox, h.Db, h.WebPush, new InMemoryJobEvents());
        var first = await handler.Handle(new WatchAdminInboxCommand(null, new HashSet<Guid>()), default);
        for (var i = 0; i < 5; i++)
            inbox.Arrives($"person{i}@example.com", $"Question {i}", Now.AddMinutes(1 + i));

        var run = await handler.Handle(new WatchAdminInboxCommand(first.SeenUpTo, new HashSet<Guid>()), default);

        Assert.Equal(5, run.Told.Count);
        var push = Assert.Single(h.WebPush.SentToConsole).Notification;
        Assert.Equal(("5 new emails", "/inbox"), (push.Title, push.Url));
        Assert.StartsWith("person4@example.com: Question 4", push.Body);
    }

    [Theory]
    [InlineData("\"Ada Obi\" <ada@example.com>", "Ada Obi")]
    [InlineData("Ada Obi <ada@example.com>", "Ada Obi")]
    [InlineData("ada@example.com", "ada@example.com")]
    [InlineData("<ada@example.com>", "<ada@example.com>")]
    public void The_sender_is_named_as_a_person_reads_it(string from, string named)
        => Assert.Equal(named, AdminInboxCopy.Sender(from));
}
