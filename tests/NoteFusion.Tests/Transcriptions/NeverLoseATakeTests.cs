using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// Never losing a take (boards 12 and 13). A job the transcription service lost says so with a stable code,
/// <c>JOB_LOST</c>, on every path and for as long as anyone asks, so the phone sends the recording again; a
/// repeated submit with the same <c>Idempotency-Key</c> is the same job, never a second one or a second charge;
/// and every finished transcription is filed in the owner's library the moment its job is settled Done.
/// </summary>
public class NeverLoseATakeTests
{
    // A Friday morning in Lagos (09:00 UTC is 10:00 WAT).
    private static readonly DateTime Now = new(2026, 10, 16, 9, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- JOB_LOST on every lost path

    [Fact]
    public async Task A_job_the_worker_forgot_is_lost_with_its_code_and_still_says_so_after_settlement()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);
        var api = new Worker { Unreachable = Error.NotFound("Api.Job", "gone") };

        var first = (await Poll(h, ada, api)).Value;
        Assert.Equal(TranscriptionStatus.Failed, first.Status);
        Assert.Equal(TranscriptionJob.LostCode, first.ErrorCode);
        Assert.Equal(TranscriptionJob.LostCode, h.Db.TranscriptionJobs.Single().FailureCode);
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);

        // Asked again later, answered from our own row: still lost, never "could not be transcribed".
        h.Clock.UtcNow = Now.AddHours(2);
        var later = (await Poll(h, ada, api)).Value;
        Assert.Equal(TranscriptionJob.LostCode, later.ErrorCode);
        Assert.DoesNotContain("could not be transcribed", later.Error);
    }

    [Fact]
    public async Task The_completion_steps_lost_closures_carry_the_code_and_a_later_poll_still_answers_it()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        var forgotten = Open(h, ada, "job-404");
        var unanswered = Open(h, ada, "job-late", Now.AddHours(-1));
        var stuck = Open(h, ada, "job-stuck", Now.AddHours(-5));
        var notifier = new Notifier();

        await Notify(h, forgotten, new Worker { Unreachable = Error.NotFound("Api.Job", "gone") }, notifier);
        await Notify(h, unanswered, new Worker { Unreachable = Error.Network("Api.Job", "down") }, notifier);
        await Notify(h, stuck, new Worker { Status = TranscriptionStatus.Processing }, notifier);

        Assert.All(h.Db.TranscriptionJobs.ToList(), j => Assert.Equal(TranscriptionJob.LostCode, j.FailureCode));
        Assert.All(notifier.Sent, dto => Assert.Equal(TranscriptionJob.LostCode, dto.ErrorCode));
        Assert.Equal(3, notifier.Sent.Count);

        // The phone comes back after the worker has forgotten them all.
        var gone = new Worker { Unreachable = Error.NotFound("Api.Job", "gone") };
        foreach (var id in new[] { "job-404", "job-late", "job-stuck" })
            Assert.Equal(TranscriptionJob.LostCode, (await Poll(h, ada, gone, id)).Value.ErrorCode);
    }

    [Fact]
    public async Task The_workers_own_lost_sentence_becomes_the_code_and_is_kept_on_the_row()
    {
        const string body = """
            {"status":"failed","progress":0,"error":"The transcription service had to restart while working on this and could not finish it. Nothing was charged — please submit it again."}
            """;
        var client = new TranscriptionApiClient(
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.OK, body)) { BaseAddress = new Uri("http://worker/") },
            new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        var job = (await client.GetJobAsync("job-1")).Value;
        Assert.Equal(TranscriptionJob.LostCode, job.ErrorCode);

        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);
        await Poll(h, ada, new Worker { Status = TranscriptionStatus.Failed, FailureReason = job.Error, FailureCode = job.ErrorCode });
        Assert.Equal(TranscriptionJob.LostCode, h.Db.TranscriptionJobs.Single().FailureCode);
        Assert.Equal(TranscriptionJob.LostCode,
            (await Poll(h, ada, new Worker { Unreachable = Error.NotFound("Api.Job", "gone") })).Value.ErrorCode);
    }

    [Fact]
    public async Task A_failure_about_the_recording_has_no_code_before_or_after_settlement()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);

        var failed = (await Poll(h, ada, new Worker
        {
            Status = TranscriptionStatus.Failed,
            FailureReason = "No confident notes were detected in the recording."
        })).Value;
        Assert.Null(failed.ErrorCode);
        Assert.Null(h.Db.TranscriptionJobs.Single().FailureCode);

        var later = (await Poll(h, ada, new Worker { Unreachable = Error.NotFound("Api.Job", "gone") })).Value;
        Assert.Null(later.ErrorCode);
        Assert.Contains("could not be transcribed", later.Error);
        Assert.Null(JobFailures.CodeFor("No confident notes were detected in the recording."));
    }

    // ---------------------------------------------------------------- the idempotent submit

    [Fact]
    public async Task A_repeated_key_from_the_same_account_is_the_same_job_and_is_charged_once()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        var api = new Worker();

        var first = await Submit(h, ada, api, "take-7a.0");
        var again = await Submit(h, ada, api, "take-7a.0");

        Assert.True(first.IsSuccess);
        Assert.Equal(first.Value, again.Value);
        Assert.Equal(1, api.Submits);
        var row = Assert.Single(h.Db.TranscriptionJobs);
        Assert.Equal("take-7a.0", row.IdempotencyKey);
        Assert.Single(h.Db.TranscriptionLogs);

        // It finishes once, and is charged once, however many times it was sent.
        api.Status = TranscriptionStatus.Done;
        await Poll(h, ada, api, first.Value);
        await Poll(h, ada, api, first.Value);
        Assert.NotNull(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
        var allowance = await TrialUsage.ReadAsync(h.Db, ada.Id, null, null, Now, CancellationToken.None);
        Assert.Equal(1, allowance.FreeUsed);
    }

    [Fact]
    public async Task A_repeat_is_handed_its_job_even_when_the_free_ones_are_gone_since()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        var api = new Worker();
        for (var i = 0; i < 3; i++)
            Assert.True((await Submit(h, ada, api, $"take-{i}")).IsSuccess);

        // The last answer was lost; the phone sends the third again: it is the third, not a fourth.
        var repeat = await Submit(h, ada, api, "take-2");
        Assert.True(repeat.IsSuccess);
        Assert.Equal(3, h.Db.TranscriptionJobs.Count());
        Assert.False((await Submit(h, ada, api, "take-3")).IsSuccess); // a genuinely new one is refused
    }

    [Fact]
    public async Task Two_accounts_with_the_same_key_never_collide_and_no_key_is_never_a_repeat()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h, "ada@example.com");
        var bola = Seed(h, "bola@example.com");
        var api = new Worker();

        var a = await Submit(h, ada, api, "same-key");
        var b = await Submit(h, bola, api, "same-key");
        await Submit(h, ada, api, null);
        await Submit(h, ada, api, null);

        Assert.NotEqual(a.Value, b.Value);
        Assert.Equal(4, api.Submits);
        Assert.Equal(4, h.Db.TranscriptionJobs.Count());
    }

    // ---------------------------------------------------------------- filed at once (option A)

    [Fact]
    public async Task A_finished_job_is_filed_at_once_named_for_when_it_was_sent_in_the_owners_zone()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);
        var api = new Worker { Status = TranscriptionStatus.Done };

        var done = (await Poll(h, ada, api)).Value;

        var sheet = Assert.Single(h.Db.Transcriptions);
        Assert.Equal(sheet.Id, done.SavedId);
        Assert.Equal("Recording · Fri 10:00", sheet.Title);
        Assert.Equal(sheet.Title, done.SavedTitle);
        Assert.True(sheet.SavedAutomatically);
        Assert.Null(sheet.OpenedAtUtc);
        Assert.Equal("job-1", sheet.SourceJobId);
        Assert.NotNull(h.Db.TranscriptionJobs.Single().AutoSavedAtUtc);

        // Polled again: the same sheet, never a second.
        Assert.Equal(sheet.Id, (await Poll(h, ada, api)).Value.SavedId);
        Assert.Single(h.Db.Transcriptions);

        // The sweep, the fallback, finds nothing left to keep.
        h.Clock.UtcNow = Now.AddHours(1);
        Assert.Equal(0, (await new AutoSaveFinishedTranscriptionsCommandHandler(h.Db, h.Clock, h.QuotaGate)
            .Handle(new AutoSaveFinishedTranscriptionsCommand(), CancellationToken.None)).Value);
    }

    [Fact]
    public async Task The_title_is_the_hymn_it_recognised_and_the_clock_is_the_owners()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h, "ada@example.com");
        var kenji = Seed(h, "kenji@example.com");
        await h.Db.Users.Where(u => u.Id == kenji.Id).ExecuteUpdateAsync(s => s.SetProperty(u => u.TimeZone, "Asia/Tokyo"));
        Open(h, ada, "job-hymn");
        Open(h, kenji, "job-tokyo");

        await Poll(h, ada, new Worker { Status = TranscriptionStatus.Done, Hymn = "Abide with Me" }, "job-hymn");
        await Poll(h, kenji, new Worker { Status = TranscriptionStatus.Done }, "job-tokyo");

        Assert.Equal("Abide with Me", h.Db.Transcriptions.Single(t => t.UserId == ada.Id).Title);
        Assert.Equal("Recording · Fri 18:00", h.Db.Transcriptions.Single(t => t.UserId == kenji.Id).Title);
    }

    [Fact]
    public async Task The_completion_step_files_it_before_the_push_and_tells_the_client_which_sheet()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        var job = Open(h, ada);
        var notifier = new Notifier();

        await Notify(h, job, new Worker { Status = TranscriptionStatus.Done }, notifier);

        var sheet = Assert.Single(h.Db.Transcriptions);
        Assert.True(sheet.SavedAutomatically);
        Assert.Equal(sheet.Id, Assert.Single(notifier.Sent).SavedId);
        Assert.Single(h.Push.Sent);
    }

    [Fact]
    public async Task A_free_accounts_filed_sheet_is_what_the_poll_hands_them_and_no_more()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);

        await Poll(h, ada, new Worker { Status = TranscriptionStatus.Done, WithParts = true });

        Assert.Null(Assert.Single(h.Db.Transcriptions).Parts);

        using var pro = new TestHarness(Now);
        var bola = Seed(pro, "bola@example.com");
        GoPro(pro, bola);
        Open(pro, bola);
        await Poll(pro, bola, new Worker { Status = TranscriptionStatus.Done, WithParts = true });
        Assert.NotNull(Assert.Single(pro.Db.Transcriptions).Parts);
    }

    [Fact]
    public async Task A_save_afterwards_replaces_the_filed_copy_and_a_deleted_one_stays_deleted()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada);
        var api = new Worker { Status = TranscriptionStatus.Done };
        await Poll(h, ada, api);

        // The web app's Save of the same job: one sheet, the person's own version.
        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(ada.Id), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Sunday anthem", "G major", 96, "4/4", "<score-partwise version=\"4.0\" />",
                Finished(null).Notes, 0.9, "job-1"), CancellationToken.None);
        var sheet = Assert.Single(h.Db.Transcriptions);
        Assert.Equal(saved.Value.Id, sheet.Id);
        Assert.Equal("Sunday anthem", sheet.Title);
        Assert.False(sheet.SavedAutomatically);
        Assert.Equal(sheet.Id, (await Poll(h, ada, api)).Value.SavedId);

        // Deleted: polled again, it is not filed a second time.
        h.Db.Transcriptions.Remove(sheet);
        await h.Db.SaveChangesAsync();
        var after = (await Poll(h, ada, api)).Value;
        Assert.Null(after.SavedId);
        Assert.Empty(h.Db.Transcriptions);
    }

    [Fact]
    public async Task Opening_or_renaming_marks_it_opened_and_only_then_does_it_count_as_kept()
    {
        using var h = new TestHarness(Now);
        var ada = Seed(h);
        Open(h, ada, "job-a");
        Open(h, ada, "job-b");
        var api = new Worker { Status = TranscriptionStatus.Done };
        var a = (await Poll(h, ada, api, "job-a")).Value.SavedId!.Value;
        var b = (await Poll(h, ada, api, "job-b")).Value.SavedId!.Value;
        Assert.Equal(0, await h.Db.KeptSheets().CountAsync());

        Assert.True((await new MarkSheetOpenedCommandHandler(h.Db, new StubCurrentUser(ada.Id), h.Clock)
            .Handle(new MarkSheetOpenedCommand(a), CancellationToken.None)).IsSuccess);
        await new RenameTranscriptionCommandHandler(h.Db, new StubCurrentUser(ada.Id))
            .Handle(new RenameTranscriptionCommand(b, "Evening hymn"), CancellationToken.None);

        Assert.Equal(Now, h.Db.Transcriptions.Single(t => t.Id == a).OpenedAtUtc);
        Assert.NotNull(h.Db.Transcriptions.Single(t => t.Id == b).OpenedAtUtc);
        Assert.Equal(2, await h.Db.KeptSheets().CountAsync());

        // Not someone else's to open.
        var bola = Seed(h, "bola@example.com");
        Assert.False((await new MarkSheetOpenedCommandHandler(h.Db, new StubCurrentUser(bola.Id), h.Clock)
            .Handle(new MarkSheetOpenedCommand(a), CancellationToken.None)).IsSuccess);
    }

    // ---------------------------------------------------------------- fixtures

    private static TranscriptionResultDto Finished(string? hymn, bool parts = false) => new(
        "G major", 0.91, 96, "4/4",
        "<score-partwise version=\"4.0\" />", "TVRoZAAAAAY=",
        [
            new NoteEventDto(67, 0, 1, 5, "s", "", 0.95),
            new NoteEventDto(69, 1, 1, 6, "l", "", 0.88)
        ],
        ["s l s"], 0.9, "")
    {
        HymnMatch = hymn is null ? null : new HymnMatchDto("abide-with-me", hymn, "Eventide", "https://notefusion.studio/hymns/abide-with-me", "", "", "", "score", 0.9),
        Parts = parts
            ? new Dictionary<string, PartDto> { ["alto"] = new([new NoteEventDto(62, 0, 1, 2, "r", "", 1)], ["r"]) }
            : null,
        PartsMusicXml = parts ? "<satb/>" : string.Empty,
    };

    private static User Seed(TestHarness h, string email = "ada@example.com")
    {
        var user = User.Create("Ada Obi", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private static TranscriptionJob Open(TestHarness h, User user, string jobId = "job-1", DateTime? createdAtUtc = null)
    {
        var job = TranscriptionJob.Record(jobId, user.Id, createdAtUtc ?? Now);
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return job;
    }

    private static Task<Result<TranscriptionJobDto>> Poll(TestHarness h, User user, Worker api, string jobId = "job-1")
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate, h.Backing)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    private static Task<Result> Notify(TestHarness h, TranscriptionJob job, Worker api, Notifier notifier)
        => new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, notifier, h.WebPush, h.QuotaGate, h.Backing)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), CancellationToken.None);

    private static Task<Result<string>> Submit(TestHarness h, User user, Worker api, string? key)
        => new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister,
                h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null,
                IdempotencyKey: key), CancellationToken.None);

    private sealed class Notifier : ITranscriptionNotifier
    {
        public List<TranscriptionJobDto> Sent { get; } = [];

        public Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default)
        {
            Sent.Add(job);
            return Task.CompletedTask;
        }
    }

    /// <summary>The Python worker: a job in one state, a forgotten or unreachable one, and a count of uploads.</summary>
    private sealed class Worker : ITranscriptionApi
    {
        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Processing;
        public string? FailureReason { get; set; }
        public string? FailureCode { get; set; }
        public string? Hymn { get; set; }
        public bool WithParts { get; set; }
        public Error? Unreachable { get; set; }
        public int Submits { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            Submits++;
            return Task.FromResult(Result<string>.Success($"job-{Submits}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, "link", options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            if (Unreachable is { } error)
                return Task.FromResult(Result.Failure<TranscriptionJobDto>(error));
            var done = Status == TranscriptionStatus.Done;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(
                jobId, Status, done ? 1d : 0.4d, done ? Finished(Hymn, WithParts) : null, FailureReason, ErrorCode: FailureCode)));
        }

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
