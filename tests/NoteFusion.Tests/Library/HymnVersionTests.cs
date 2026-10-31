using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Library;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// "Use the hymnbook version": a sheet saved as a hymn's published score keeps that hymn's credit, read from
/// the job's own result (the worker's <c>hymnMatch</c>), never from what the client sends.
/// </summary>
public class HymnVersionTests
{
    private const string Credit = "Tune NEW BRITAIN (traditional American melody); words by John Newton (1725–1807).";

    private static readonly IReadOnlyList<NoteEventDto> Hymnbook =
    [
        new(64, 2.0, 1.0, 5, "s", ",", 1.0),
        new(69, 3.0, 2.0, 1, "d", "", 1.0),
        new(73, 5.0, 0.5, 3, "m", "", 1.0),
    ];

    [Fact]
    public async Task A_sheet_saved_as_the_offered_hymn_keeps_its_credit()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        await SeedJob(h, userId, "job-1", Offer("amazing-grace", "score"));

        var saved = await Save(h, userId, "job-1", "amazing-grace");

        Assert.True(saved.IsSuccess);
        Assert.Equal(new HymnCreditDto("amazing-grace", "Amazing Grace", "https://notefusion.studio/hymns/amazing-grace", Credit), saved.Value.Hymn);
        Assert.Equal("3/4", saved.Value.TimeSignature);

        var stored = h.Db.Transcriptions.Single();
        var shared = SavedTranscriptionMapper.ToShared(stored, "Francis");
        Assert.Equal(Credit, shared.Hymn!.Credit);
    }

    [Fact]
    public async Task A_hymn_picked_from_those_sung_to_the_matched_tune_keeps_its_own_credit()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        const string pickedCredit = "Tune NEW BRITAIN; words by Isaac Watts (1674–1748).";
        var tune = Offer("tune-new-britain", "score") with
        {
            Settings = [new HymnSettingDto("alas-and-did-my-saviour-bleed", "Alas! and Did My Saviour Bleed",
                "https://notefusion.studio/hymns/alas-and-did-my-saviour-bleed", pickedCredit, "A-las! and did")],
            SettingsTotal = 1,
        };
        await SeedJob(h, userId, "job-1", tune);

        var saved = await Save(h, userId, "job-1", "alas-and-did-my-saviour-bleed");

        Assert.Equal(new HymnCreditDto("alas-and-did-my-saviour-bleed", "Alas! and Did My Saviour Bleed",
            "https://notefusion.studio/hymns/alas-and-did-my-saviour-bleed", pickedCredit), saved.Value.Hymn);
        // Still only what the job offered: a hymn sung to some other tune is not credited.
        Assert.Null((await Save(h, userId, "job-1", "abide-with-me")).Value.Hymn);
    }

    [Fact]
    public void A_page_whose_words_chose_a_hymn_is_named_after_that_hymn()
    {
        var alas = new HymnSettingDto("alas-and-did-my-saviour-bleed", "Alas! and Did My Saviour Bleed",
            "https://notefusion.studio/hymns/alas-and-did-my-saviour-bleed", "Words by Isaac Watts.", "A-las!");
        var tune = Offer("tune-new-britain", "score") with { Title = "New Britain", Settings = [alas], SettingsTotal = 1 };
        Assert.Equal("New Britain", tune.ShownTitle());
        Assert.Null(tune.ChosenSetting());

        var chosen = tune with { Chosen = alas.Slug };
        Assert.Equal(alas, chosen.ChosenSetting());
        Assert.Equal("Alas! and Did My Saviour Bleed", chosen.ShownTitle());

        var job = TranscriptionJob.Record("job-1", Guid.NewGuid(), new DateTime(2026, 10, 31, 12, 0, 0, DateTimeKind.Utc));
        var result = new TranscriptionResultDto("A major", 0.8, 84, "4/4", "<s/>", "", Hymnbook, ["Doh is A"], 0.7, HymnMatch: chosen);
        Assert.Equal("Alas! and Did My Saviour Bleed", LibraryFiling.TitleFor(job, result, TimeZoneInfo.Utc));
    }

    [Fact]
    public async Task A_hymn_the_job_did_not_offer_is_not_credited()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        await SeedJob(h, userId, "job-1", Offer("amazing-grace", "score"));
        await SeedJob(h, userId, "job-2", null);

        Assert.Null((await Save(h, userId, "job-1", "abide-with-me")).Value.Hymn);
        Assert.Null((await Save(h, userId, "job-2", "amazing-grace")).Value.Hymn);
        Assert.Null((await Save(h, userId, "job-3", "amazing-grace")).Value.Hymn);
    }

    [Fact]
    public async Task Another_accounts_job_and_a_recognition_only_match_credit_nothing()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        var otherId = await SeedUser(h, "other@example.com");
        await SeedJob(h, otherId, "job-theirs", Offer("amazing-grace", "score"));
        await SeedJob(h, userId, "job-incipit", Offer("amazing-grace", "incipit"));

        Assert.Null((await Save(h, userId, "job-theirs", "amazing-grace")).Value.Hymn);
        Assert.Null((await Save(h, userId, "job-incipit", "amazing-grace")).Value.Hymn);
    }

    [Fact]
    public async Task The_overview_counts_hymn_offers_and_hymnbook_versions_saved()
    {
        using var h = new TestHarness();
        var userId = await SeedUser(h);
        await SeedJob(h, userId, "job-1", Offer("amazing-grace", "score"));
        await SeedJob(h, userId, "job-2", Offer("abide-with-me", "score"));
        await SeedJob(h, userId, "job-3", null);
        await Save(h, userId, "job-1", "amazing-grace");
        await Save(h, userId, "job-3", null);
        // A sheet takes the wall clock when it is made; the overview reads it against the test's.
        foreach (var sheet in h.Db.Transcriptions)
            h.Db.Entry(sheet).Property(t => t.CreatedAtUtc).CurrentValue = h.Clock.UtcNow.AddMinutes(-1);
        await h.Db.SaveChangesAsync();

        var overview = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock)
            .Handle(new GetAnalyticsOverviewQuery(), default);

        Assert.Equal(2, overview.Value.Transcriptions.HymnMatchesOffered);
        Assert.Equal(1, overview.Value.Transcriptions.HymnVersionsSaved);
    }

    private static HymnMatchDto Offer(string slug, string kind)
        => kind == "score"
            ? new HymnMatchDto(slug, "Amazing Grace", "NEW BRITAIN", $"https://notefusion.studio/hymns/{slug}", "NoteFusion",
                "Public domain.", Credit, "score", 0.7, "A major", "3/4", 72, 1, Hymnbook, ["Doh is A"], "<hymn/>", "A-maz-ing")
            : new HymnMatchDto(slug, "Amazing Grace", "", $"https://notefusion.studio/hymns/{slug}", "NoteFusion",
                "Public domain.", Credit, "incipit", 0.7);

    private static async Task SeedJob(TestHarness h, Guid userId, string jobId, HymnMatchDto? hymn)
    {
        var heard = new TranscriptionResultDto("A major", 0.8, 84, "4/4", "<s/>", "", Hymnbook, ["Doh is A"], 0.7, HymnMatch: hymn);
        var job = TranscriptionJob.Record(jobId, userId, h.Clock.UtcNow.AddMinutes(-5));
        job.Settle(TranscriptionResultCache.Serialize(heard), h.Clock.UtcNow.AddMinutes(-4));
        h.Db.TranscriptionJobs.Add(job);
        await h.Db.SaveChangesAsync();
    }

    private static Task<NoteFusion.Shared.Results.Result<SavedTranscriptionDto>> Save(TestHarness h, Guid userId, string jobId, string? hymnSlug)
        => new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(userId), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Amazing Grace", "A major", 72, "3/4", "<hymn/>", Hymnbook, 1.0, jobId,
                Lyrics: "A-maz-ing", HymnSlug: hymnSlug),
            default);

    private static async Task<Guid> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }
}
