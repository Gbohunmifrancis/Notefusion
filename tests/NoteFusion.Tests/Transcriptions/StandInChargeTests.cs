using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// When YouTube refuses a linked song, the worker hands back the store's 30-second preview in its place
/// (<c>source.preview</c>). That is not the song that was asked for, so it costs nothing, as a failed job costs nothing:
/// no song credit, no bought transcription, not the free account's one link preview. Those charged for one before are
/// handed it back.
/// </summary>
public class StandInChargeTests
{
    [Fact]
    public async Task A_free_accounts_link_preview_is_not_spent_on_a_stand_in()
    {
        using var h = new TestHarness();
        var (user, job) = Seed(h, paidByCredit: false);

        await Notify(h, job, Result(standIn: true));

        Assert.NotNull(job.SettledAtUtc);
        Assert.Null(job.SongCreditConsumedAtUtc);
        Assert.Equal(0, await SongCredits.CountPreviewsUsedAsync(h.Db, user.Id, "phone-a", h.Clock.UtcNow));
    }

    [Fact]
    public async Task A_bought_transcription_is_not_spent_on_a_stand_in_but_is_on_the_song()
    {
        using var h = new TestHarness();
        var (user, standIn) = Seed(h, paidByCredit: true);
        var song = TranscriptionJob.RecordLink("job-2", user.Id, h.Clock.UtcNow, "phone-a", wasPro: false, paidByCredit: true);
        h.Db.TranscriptionJobs.Add(song);
        await h.Db.SaveChangesAsync();

        await Notify(h, standIn, Result(standIn: true));
        await Notify(h, song, Result(standIn: false));

        Assert.Null(standIn.TrialConsumedAtUtc);
        Assert.NotNull(song.TrialConsumedAtUtc);
        Assert.Equal(1, await TrialUsage.CountBoughtSpentAsync(h.Db, user.Id, h.Clock.UtcNow));
    }

    [Fact]
    public async Task The_clients_own_read_of_a_finished_stand_in_charges_nothing_either()
    {
        using var h = new TestHarness();
        var (user, job) = Seed(h, paidByCredit: false);
        var api = Worker(job, Result(standIn: true));

        var read = await new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate, h.Backing)
            .Handle(new GetTranscriptionJobQuery(job.JobId), default);

        Assert.Equal(TranscriptionStatus.Done, read.Value.Status);
        Assert.True(read.Value.Result!.Source!.Preview);
        Assert.Null(job.SongCreditConsumedAtUtc);
    }

    [Fact]
    public void A_pro_song_credit_is_not_spent_on_a_stand_in()
    {
        var job = TranscriptionJob.RecordLink("job-1", Guid.NewGuid(), DateTime.UtcNow, "phone-a", wasPro: true);

        JobCharge.Apply(job, Result(standIn: true), isPro: true, DateTime.UtcNow);
        Assert.Null(job.SongCreditConsumedAtUtc);

        JobCharge.Apply(job, Result(standIn: false), isPro: true, DateTime.UtcNow);
        Assert.NotNull(job.SongCreditConsumedAtUtc);
    }

    [Fact]
    public async Task Those_charged_for_a_stand_in_before_are_handed_it_back_once()
    {
        using var h = new TestHarness();
        var (user, standIn) = Seed(h, paidByCredit: true);
        var song = TranscriptionJob.RecordLink("job-2", user.Id, h.Clock.UtcNow, "phone-a", wasPro: false, paidByCredit: true);
        var preview = TranscriptionJob.RecordLink("job-3", user.Id, h.Clock.UtcNow, "phone-a", wasPro: false);
        h.Db.TranscriptionJobs.AddRange(song, preview);
        // Charged as they used to be: every finished link, stand-in or not.
        foreach (var (job, standInResult) in new[] { (standIn, true), (song, false), (preview, true) })
        {
            job.Settle(TranscriptionResultCache.Serialize(Result(standInResult)), h.Clock.UtcNow);
            if (job.IsSong) job.ConsumeSongCredit(h.Clock.UtcNow);
            else job.ConsumeTrial(h.Clock.UtcNow);
        }
        await h.Db.SaveChangesAsync();

        var handedBack = await StandInChargeRefund.RunAsync(h.Db);
        var again = await StandInChargeRefund.RunAsync(h.Db);

        Assert.Equal((2, 0), (handedBack, again));
        Assert.Null(standIn.TrialConsumedAtUtc);
        Assert.Null(preview.SongCreditConsumedAtUtc);
        Assert.NotNull(song.TrialConsumedAtUtc);
        Assert.Equal(0, await SongCredits.CountPreviewsUsedAsync(h.Db, user.Id, "phone-a", h.Clock.UtcNow));
        Assert.Equal(1, await TrialUsage.CountBoughtSpentAsync(h.Db, user.Id, h.Clock.UtcNow));
    }

    /// <summary>A free account with one linked song running on "phone-a".</summary>
    private static (User User, TranscriptionJob Job) Seed(TestHarness h, bool paidByCredit)
    {
        var user = User.Create("Ada Obi", "ada@example.com", "hash", h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.RecordLink("job-1", user.Id, h.Clock.UtcNow, "phone-a", wasPro: false, paidByCredit);
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return (user, job);
    }

    private static TranscriptionResultDto Result(bool standIn) => new(
        "G major", 0.9, 96, "4/4", "<score-partwise version=\"4.0\" />", "",
        [new NoteEventDto(67, 0, 1, 5, "s", "", 0.95)], ["s"], 0.9, "")
    {
        Source = new SourceDto("youtube", "https://youtu.be/x", "Abide with me", "Choir", null,
            Preview: standIn ? true : null, Notice: standIn ? "Only a 30-second preview was available for this song." : null)
    };

    private static ITranscriptionApi Worker(TranscriptionJob job, TranscriptionResultDto result)
    {
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>())
            .Returns(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, result)));
        return api;
    }

    private static async Task Notify(TestHarness h, TranscriptionJob job, TranscriptionResultDto result)
    {
        var done = await new NotifyTranscriptionReadyCommandHandler(
                h.Db, Worker(job, result), h.Clock, h.Push, Substitute.For<ITranscriptionNotifier>(), h.WebPush, h.QuotaGate, h.Backing)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), default);
        Assert.True(done.IsSuccess);
    }
}
