using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The console's Hymns recognised page: which hymns finished takes matched, how often and by whom, how many were kept as
/// the hymnbook version, and the team's own accounts left out unless asked for.
/// </summary>
public class RecognisedHymnsTests
{
    private static readonly IReadOnlyList<NoteEventDto> Notes = [new NoteEventDto(69, 0, 1, 5, "d", "", 0.9)];

    [Fact]
    public async Task Hymns_are_counted_per_take_and_account_with_the_ones_kept()
    {
        using var h = new TestHarness();
        var ada = await SeedUser(h, "ada@example.com");
        var bayo = await SeedUser(h, "bayo@example.com");
        await SeedJob(h, ada, "j1", Offer("amazing-grace", "Amazing Grace", "score"), minutesAgo: 30);
        await SeedJob(h, bayo, "j2", Offer("amazing-grace", "Amazing Grace", "score"), minutesAgo: 20);
        await SeedJob(h, ada, "j3", Offer("abide-with-me", "Abide with Me", "incipit"), minutesAgo: 10);
        await SeedJob(h, bayo, "j4", null, minutesAgo: 5);
        await Keep(h, ada, "j1", "amazing-grace");

        var d = await Read(h);

        Assert.Equal(4, d.Finished);
        Assert.Equal(3, d.Recognised);
        Assert.Equal(2, d.Accounts);
        Assert.Equal(1, d.Kept);
        var grace = d.Hymns[0];
        Assert.Equal(("amazing-grace", "Amazing Grace", "score", 2, 2, 1), (grace.Slug, grace.Title, grace.Kind, grace.Times, grace.Accounts, grace.Kept));
        Assert.Equal(("abide-with-me", "incipit", 1), (d.Hymns[1].Slug, d.Hymns[1].Kind, d.Hymns[1].Times));
        Assert.Equal(["j3:ada@example.com:False", "j2:bayo@example.com:False", "j1:ada@example.com:True"],
            d.Recent.Select(r => $"{(r.Slug == "abide-with-me" ? "j3" : r.Email.StartsWith("bayo") ? "j2" : "j1")}:{r.Email}:{r.Kept}"));
    }

    [Fact]
    public async Task The_teams_own_takes_are_left_out_unless_asked_for()
    {
        using var h = new TestHarness();
        var me = await SeedUser(h, "founder@example.com", isInternal: true);
        await SeedJob(h, me, "mine", Offer("amazing-grace", "Amazing Grace", "score"), minutesAgo: 10);

        Assert.Equal(0, (await Read(h)).Recognised);
        var all = await Read(h, includeInternal: true);
        Assert.True(all.IncludesInternal);
        Assert.Equal("amazing-grace", Assert.Single(all.Hymns).Slug);
        Assert.Equal("founder@example.com", Assert.Single(all.Recent).Email);
    }

    [Fact]
    public async Task Takes_outside_the_window_and_unreadable_results_are_not_counted()
    {
        using var h = new TestHarness();
        var ada = await SeedUser(h, "ada@example.com");
        await SeedJob(h, ada, "old", Offer("amazing-grace", "Amazing Grace", "score"), minutesAgo: 60 * 24 * 40);
        var broken = TranscriptionJob.Record("broken", ada, h.Clock.UtcNow.AddMinutes(-5));
        broken.Settle("{\"hymnMatch\":{\"slug\":", h.Clock.UtcNow.AddMinutes(-4));
        h.Db.TranscriptionJobs.Add(broken);
        await h.Db.SaveChangesAsync();

        var d = await Read(h);

        Assert.Equal(1, d.Finished);
        Assert.Equal(0, d.Recognised);
        Assert.Empty(d.Hymns);
    }

    private static async Task<RecognisedHymnsDto> Read(TestHarness h, bool includeInternal = false)
    {
        var result = await new GetRecognisedHymnsQueryHandler(h.Db, h.Clock)
            .Handle(new GetRecognisedHymnsQuery(IncludeInternal: includeInternal), default);
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static HymnMatchDto Offer(string slug, string title, string kind)
        => kind == "score"
            ? new HymnMatchDto(slug, title, "NEW BRITAIN", $"https://notefusion.studio/hymns/{slug}", "NoteFusion",
                "Public domain.", "Tune NEW BRITAIN.", "score", 0.7, "A major", "3/4", 72, 1, Notes, ["Doh is A"], "<hymn/>", "A-maz-ing")
            : new HymnMatchDto(slug, title, "", $"https://notefusion.studio/hymns/{slug}", "NoteFusion",
                "Public domain.", "", "incipit", 0.6);

    private static async Task SeedJob(TestHarness h, Guid userId, string jobId, HymnMatchDto? hymn, int minutesAgo)
    {
        var heard = new TranscriptionResultDto("A major", 0.8, 84, "4/4", "<s/>", "", Notes, ["Doh is A"], 0.7, HymnMatch: hymn);
        var job = TranscriptionJob.Record(jobId, userId, h.Clock.UtcNow.AddMinutes(-minutesAgo));
        job.Settle(TranscriptionResultCache.Serialize(heard), h.Clock.UtcNow.AddMinutes(-minutesAgo + 1));
        h.Db.TranscriptionJobs.Add(job);
        await h.Db.SaveChangesAsync();
    }

    private static Task Keep(TestHarness h, Guid userId, string jobId, string slug)
        => new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Amazing Grace", "A major", 72, "3/4", "<hymn/>", Notes, 1.0, jobId,
                Lyrics: "A-maz-ing", HymnSlug: slug),
            default);

    private static async Task<Guid> SeedUser(TestHarness h, string email, bool isInternal = false)
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        user.SetInternal(isInternal);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
