using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The ready push goes to someone who stopped watching, so it is sent at FCM's high priority (a time to live makes
/// the Expo sender ask for it): at normal priority Android held it through Doze, so a phone left on the table got its
/// "your transcription is ready" minutes late, or only when it was picked up.
/// </summary>
public class ReadyPushPriorityTests
{
    [Fact]
    public async Task The_ready_push_carries_a_days_time_to_live()
    {
        using var h = new TestHarness();
        var job = SeedJob(h);

        await Notify(h, job, new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, Done()));

        var push = Assert.Single(h.Push.Sent).Message;
        Assert.Equal(NotifyTranscriptionReadyCommand.PushTimeToLiveSeconds, push.TimeToLiveSeconds);
        Assert.Equal(24 * 60 * 60, push.TimeToLiveSeconds);
    }

    [Fact]
    public async Task The_failed_push_is_as_urgent_as_the_ready_one()
    {
        using var h = new TestHarness();
        var job = SeedJob(h);

        await Notify(h, job, new TranscriptionJobDto(job.JobId, TranscriptionStatus.Failed, 1, null, "We couldn't hear any notes."));

        var push = Assert.Single(h.Push.Sent).Message;
        Assert.Equal(NotifyTranscriptionReadyCommand.PushTimeToLiveSeconds, push.TimeToLiveSeconds);
    }

    [Fact]
    public void A_message_with_a_time_to_live_goes_to_Expo_at_high_priority_and_one_without_does_not()
    {
        var urgent = ExpoPushMessage.From("ExponentPushToken[x]", new PushMessage("t", "b", TimeToLiveSeconds: 60));
        var plain = ExpoPushMessage.From("ExponentPushToken[x]", new PushMessage("t", "b"));

        Assert.Equal(("high", 60), (urgent.Priority, urgent.Ttl));
        Assert.Null(plain.Priority);
    }

    private static TranscriptionJob SeedJob(TestHarness h)
    {
        var user = User.Create("Ada Obi", "ada@example.com", "hash", h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, h.Clock.UtcNow.AddMinutes(-2));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return job;
    }

    private static TranscriptionResultDto Done() => new(
        "G major", 0.9, 96, "4/4", "<score-partwise version=\"4.0\" />", "",
        [new NoteEventDto(67, 0, 1, 5, "s", "", 0.95)], ["s"], 0.9, "");

    private static async Task Notify(TestHarness h, TranscriptionJob job, TranscriptionJobDto answer)
    {
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>()).Returns(Result<TranscriptionJobDto>.Success(answer));
        var notifier = Substitute.For<ITranscriptionNotifier>();
        var done = await new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, notifier, h.WebPush)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), default);
        Assert.True(done.IsSuccess);
    }
}
