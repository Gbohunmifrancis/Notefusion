using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Application.Outreach.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Me;

/// <summary>
/// GET/PUT /api/me/email-preferences: the app's "Notes from the founder" switch reads and writes the same
/// <see cref="EmailOptOut"/> row the email's unsubscribe link does, for the caller only, idempotently.
/// </summary>
public class EmailPreferencesTests
{
    [Fact]
    public async Task Founder_notes_are_on_until_switched_off_and_back_on()
    {
        using var h = new TestHarness();
        var ada = await Seed(h, "ada@example.com");

        Assert.True((await Get(h, ada)).Value.FounderNotes);

        var off = await Set(h, ada, false);
        Assert.False(off.Value.FounderNotes);
        Assert.Equal(ada, Assert.Single(h.Db.EmailOptOuts).UserId);
        Assert.False((await Get(h, ada)).Value.FounderNotes);

        // A second "off" (a double tap) changes nothing.
        Assert.False((await Set(h, ada, false)).Value.FounderNotes);
        Assert.Single(h.Db.EmailOptOuts);

        var on = await Set(h, ada, true);
        Assert.True(on.Value.FounderNotes);
        Assert.Empty(h.Db.EmailOptOuts);
        Assert.True((await Set(h, ada, true)).Value.FounderNotes);
        Assert.True((await Get(h, ada)).Value.FounderNotes);
    }

    [Fact]
    public async Task The_unsubscribe_link_shows_as_off_and_the_switch_can_turn_it_back_on()
    {
        using var h = new TestHarness();
        var ada = await Seed(h, "ada@example.com");
        var tokens = new HmacEmailUnsubscribeTokens(h.Keys);
        var unsubscribe = new UnsubscribeEmailCommandHandler(h.Db, h.Clock, tokens);
        Assert.True((await unsubscribe.Handle(new UnsubscribeEmailCommand(tokens.Create(ada)), default)).IsSuccess);

        Assert.False((await Get(h, ada)).Value.FounderNotes);
        Assert.True((await Set(h, ada, true)).Value.FounderNotes);
        Assert.Empty(h.Db.EmailOptOuts);
    }

    [Fact]
    public async Task One_account_switching_off_leaves_another_untouched()
    {
        using var h = new TestHarness();
        var ada = await Seed(h, "ada@example.com");
        var bob = await Seed(h, "bob@example.com");

        await Set(h, ada, false);

        Assert.False((await Get(h, ada)).Value.FounderNotes);
        Assert.True((await Get(h, bob)).Value.FounderNotes);
        Assert.Equal(ada, Assert.Single(h.Db.EmailOptOuts).UserId);
    }

    [Fact]
    public async Task No_caller_or_a_deleted_account_is_not_found()
    {
        using var h = new TestHarness();
        var ghost = Guid.NewGuid();

        foreach (var who in new Guid?[] { null, ghost })
        {
            var read = await new GetMyEmailPreferencesQueryHandler(h.Db, new StubCurrentUser(who))
                .Handle(new GetMyEmailPreferencesQuery(), default);
            var write = await new SetMyEmailPreferencesCommandHandler(h.Db, new StubCurrentUser(who), h.Clock)
                .Handle(new SetMyEmailPreferencesCommand(false), default);
            Assert.Equal("USER_NOT_FOUND", read.Error.Code);
            Assert.Equal("USER_NOT_FOUND", write.Error.Code);
        }
        Assert.Empty(h.Db.EmailOptOuts);
    }

    private static async Task<Guid> Seed(TestHarness h, string email)
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }

    private static Task<NoteFusion.Shared.Results.Result<EmailPreferencesDto>> Get(TestHarness h, Guid userId)
        => new GetMyEmailPreferencesQueryHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new GetMyEmailPreferencesQuery(), default);

    private static Task<NoteFusion.Shared.Results.Result<EmailPreferencesDto>> Set(TestHarness h, Guid userId, bool founderNotes)
        => new SetMyEmailPreferencesCommandHandler(h.Db, new StubCurrentUser(userId), h.Clock)
            .Handle(new SetMyEmailPreferencesCommand(founderNotes), default);
}
