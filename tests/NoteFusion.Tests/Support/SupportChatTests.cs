using NoteFusion.Application.Support;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Transcriptions;

namespace NoteFusion.Tests.Support;

/// <summary>
/// Live support end to end through the handlers: a visitor's and an account's thread, the console's inbox and answer,
/// who is told live and who is pushed, and the limits.
/// </summary>
public class SupportChatTests
{
    private static readonly DateTime Now = new(2026, 10, 25, 15, 0, 0, DateTimeKind.Utc);
    /// <summary>A made-up visitor key: long enough to be one, plainly not a secret.</summary>
    private const string VisitorKey = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";

    private sealed class World : IDisposable
    {
        public TestHarness H { get; } = new(Now);
        public InMemoryJobEvents Events { get; } = new();
        public User Admin { get; }

        public World()
        {
            Admin = User.CreateAdmin("Francis Gbohunmi", "francis@notefusion.studio", H.Hasher.Hash("pw"), Now.AddDays(-90));
            H.Db.Users.Add(Admin);
            H.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(Admin.Id, "https://fcm.googleapis.com/fcm/send/console", "p", "a", null, Now,
                WebPushSubscription.ConsoleAudience));
            var phone = DeviceToken.Create(Admin.Id, "ExponentPushToken[admin]", "android", 42, Now.AddDays(-1));
            H.Db.DeviceTokens.Add(phone);
            H.Db.SaveChanges();
        }

        public User Customer(string email = "ada@example.com")
        {
            var user = User.Create("Ada Obi", email, H.Hasher.Hash("pw"), Now.AddDays(-10));
            H.Db.Users.Add(user);
            H.Db.SaveChanges();
            return user;
        }

        public Task<NoteFusion.Shared.Results.Result<SupportMessageDto>> Say(string body, Guid? userId = null, string? key = VisitorKey,
            string source = "site", string? name = null, string? email = null)
            => new SendSupportMessageCommandHandler(H.Db, new StubCurrentUser(userId), H.Clock, Events, H.Push, H.WebPush)
                .Handle(new SendSupportMessageCommand(body, key, source, "/pricing", name, email), default);

        public Task<NoteFusion.Shared.Results.Result<SupportMessageDto>> Answer(Guid conversationId, string body)
            => new ReplySupportCommandHandler(H.Db, new StubCurrentUser(Admin.Id, UserRole.Admin), H.Clock, Events, H.Push, H.WebPush)
                .Handle(new ReplySupportCommand(conversationId, body), default);

        public Task<NoteFusion.Shared.Results.Result<SupportThreadDto>> Thread(Guid? userId = null, string? key = VisitorKey)
            => new GetSupportThreadQueryHandler(H.Db, new StubCurrentUser(userId), H.Clock).Handle(new GetSupportThreadQuery(key), default);

        public void Dispose() => H.Dispose();
    }

    [Fact]
    public async Task A_visitors_first_message_starts_their_thread_tells_the_console_live_and_pushes_the_admins()
    {
        using var w = new World();
        using var console = w.Events.Watch("admin:live", "user:admin")!;

        var sent = await w.Say("Hi, can I transcribe a hymn from YouTube?", name: "Chidi", email: "Chidi@Example.com");

        Assert.True(sent.IsSuccess);
        var c = Assert.Single(w.H.Db.SupportConversations);
        Assert.Null(c.UserId);
        Assert.NotEqual(VisitorKey, c.VisitorKeyHash);   // only the hash is kept
        Assert.Equal(("Chidi", "chidi@example.com", "site", "/pricing"), (c.Name, c.Email, c.Source, c.Path));
        Assert.True(c.UnreadByAdmin);
        Assert.True(console.Events.TryRead(out var told) && told.Name == "support");

        var (_, push) = Assert.Single(w.H.WebPush.SentToConsole);
        Assert.Equal("Support · Chidi", push.Title);
        Assert.Equal($"/support?c={c.Id}", push.Url);
        var (tokens, phonePush) = Assert.Single(w.H.Push.DeviceSends);
        Assert.Equal(["ExponentPushToken[admin]"], tokens);
        Assert.Equal("AdminSupport", phonePush.Data!["screen"]);
    }

    [Fact]
    public async Task A_run_of_messages_pushes_the_admins_once_until_a_pause_or_they_read_it()
    {
        using var w = new World();
        await w.Say("Hello");
        w.H.Clock.UtcNow = Now.AddSeconds(20);
        await w.Say("Are you there?");
        Assert.Single(w.H.WebPush.SentToConsole);

        w.H.Clock.UtcNow = Now.AddMinutes(3);
        await w.Say("Still need help");
        Assert.Equal(2, w.H.WebPush.SentToConsole.Count);

        var id = w.H.Db.SupportConversations.Single().Id;
        await new GetSupportConversationQueryHandler(w.H.Db, w.H.Clock, w.Events).Handle(new GetSupportConversationQuery(id), default);
        w.H.Clock.UtcNow = Now.AddMinutes(3).AddSeconds(10);
        await w.Say("Thanks");
        Assert.Equal(3, w.H.WebPush.SentToConsole.Count);   // read since, so news again
    }

    [Fact]
    public async Task A_signed_in_person_has_one_thread_on_every_device_known_by_their_account()
    {
        using var w = new World();
        var ada = w.Customer();

        await w.Say("From my phone", ada.Id, key: null, source: "app");
        w.H.Clock.UtcNow = Now.AddSeconds(30);
        await w.Say("And from the web app", ada.Id, key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", source: "web");

        var c = Assert.Single(w.H.Db.SupportConversations);
        Assert.Equal(ada.Id, c.UserId);
        Assert.Null(c.VisitorKeyHash);
        Assert.Equal("web", c.Source);
        var thread = (await w.Thread(ada.Id, key: null)).Value;
        Assert.Equal(["From my phone", "And from the web app"], thread.Messages.Select(m => m.Body));
    }

    [Fact]
    public async Task No_account_and_no_key_or_an_empty_message_is_refused()
    {
        using var w = new World();
        Assert.Equal("SUPPORT_NO_CALLER", (await w.Say("Hello", key: null)).Error.Code);
        Assert.Equal("SUPPORT_NO_CALLER", (await w.Say("Hello", key: "short")).Error.Code);
        Assert.Equal("SUPPORT_EMPTY", (await w.Say("   ")).Error.Code);
        Assert.Empty(w.H.Db.SupportConversations);
    }

    [Fact]
    public async Task Past_fifteen_messages_in_five_minutes_the_next_waits()
    {
        using var w = new World();
        for (var i = 0; i < SupportRules.BurstLimit; i++)
            Assert.True((await w.Say($"m{i}")).IsSuccess);
        Assert.Equal("SUPPORT_TOO_FAST", (await w.Say("one more")).Error.Code);

        w.H.Clock.UtcNow = Now + SupportRules.BurstWindow;
        Assert.True((await w.Say("later")).IsSuccess);
    }

    [Fact]
    public async Task An_answer_reaches_an_open_chat_live_and_a_closed_one_by_push()
    {
        using var w = new World();
        var ada = w.Customer();
        await w.Say("My upload failed", ada.Id, key: null, source: "app");
        var id = w.H.Db.SupportConversations.Single().Id;

        // Chat open: told live, no push.
        w.H.Clock.UtcNow = Now.AddMinutes(1);
        using (var chat = w.Events.Watch($"support:{id}", $"user:{ada.Id}")!)
        {
            var answer = await w.Answer(id, "Sorry about that, try again now.");
            Assert.True(answer.IsSuccess);
            Assert.Equal("Francis", answer.Value.AdminName);   // first name only
            Assert.True(chat.Events.TryRead(out var told) && told.Name == "message");
            Assert.Empty(w.H.Push.Sent);
        }

        // Chat closed: pushed to the phone and the web app.
        w.H.Clock.UtcNow = Now.AddMinutes(2);
        await w.Answer(id, "It should work now.");
        var (to, push) = Assert.Single(w.H.Push.Sent);
        Assert.Equal([ada.Id], to);
        Assert.Equal("Francis from NoteFusion", push.Title);
        Assert.Equal("SupportChat", push.Data!["screen"]);
        Assert.Contains(w.H.WebPush.Sent, s => s.UserId == ada.Id && s.Notification.Url == "/app?support=1");

        var thread = (await w.Thread(ada.Id, key: null)).Value;
        Assert.Equal([false, true, true], thread.Messages.Select(m => m.FromAdmin));
    }

    [Fact]
    public async Task The_inbox_puts_unread_open_threads_first_and_a_customer_writing_reopens_a_closed_one()
    {
        using var w = new World();
        var ada = w.Customer();
        await w.Say("Visitor question");
        w.H.Clock.UtcNow = Now.AddMinutes(1);
        await w.Say("Account question", ada.Id, key: null, source: "web");
        var visitor = w.H.Db.SupportConversations.Single(c => c.UserId == null).Id;
        var account = w.H.Db.SupportConversations.Single(c => c.UserId == ada.Id).Id;
        await w.Answer(account, "Answered");

        var inbox = (await new GetSupportInboxQueryHandler(w.H.Db).Handle(new GetSupportInboxQuery(), default)).Value;
        Assert.Equal([visitor, account], inbox.Select(r => r.Id));   // the unread visitor first
        Assert.Equal(["Visitor", "Ada Obi"], inbox.Select(r => r.Name));
        Assert.Equal(1, (await new GetSupportUnreadQueryHandler(w.H.Db).Handle(new GetSupportUnreadQuery(), default)).Value);

        await new SetSupportClosedCommandHandler(w.H.Db, w.H.Clock, w.Events).Handle(new SetSupportClosedCommand(account, true), default);
        Assert.True(w.H.Db.SupportConversations.Single(c => c.Id == account).IsClosed);
        await w.Say("One more thing", ada.Id, key: null, source: "web");
        Assert.False(w.H.Db.SupportConversations.Single(c => c.Id == account).IsClosed);
    }
}
