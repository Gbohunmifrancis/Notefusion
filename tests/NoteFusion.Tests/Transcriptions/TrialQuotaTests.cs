using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The five free transcriptions: what spends one, what does not, and who is metered at all.
/// <para>
/// The count is kept on <c>TranscriptionJobs</c> rather than on saved <c>Transcriptions</c>, and that is
/// the regression these tests exist to pin. Counting saved rows meant deleting a transcription handed the
/// slot straight back — an unlimited free tier for anyone who noticed the Library had a delete button.
/// </para>
/// <para>
/// The charge lands on the poll, not the submit, because the poll is the only point where the API learns
/// a transcription actually succeeded: submit always answers <c>Pending</c>, and the status comes from the
/// ML service rather than the client. So a job that fails costs nothing, and a client cannot dodge the
/// charge without also giving up its result.
/// </para>
/// </summary>
public class TrialQuotaTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- the gate on submit

    [Fact]
    public async Task A_free_account_is_blocked_once_all_five_are_spent()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 5);

        var result = await Submit(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_free_account_with_one_left_can_still_submit()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 4);

        var result = await Submit(h, user);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Deleting_a_saved_transcription_does_not_hand_the_slot_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        // Five successful generations, nothing left in the Library: exactly the state a user reaches by
        // transcribing five times and then deleting all five. Under the old saved-row count this was 0 used.
        Spend(h, user, 5);
        Assert.Empty(h.Db.Transcriptions);

        var result = await Submit(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_pro_account_is_not_metered_at_all()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        Spend(h, user, 10); // well past the free limit, from a lapsed spell on the free tier

        var result = await Submit(h, user);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Submitting_attributes_the_job_but_spends_nothing_yet()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var result = await Submit(h, user);

        var job = Assert.Single(h.Db.TranscriptionJobs);
        Assert.Equal(result.Value, job.JobId);
        Assert.Equal(user.Id, job.UserId);
        Assert.Null(job.TrialConsumedAtUtc); // the audio has not been transcribed yet
    }

    // ---------------------------------------------------------------- the charge on poll

    [Fact]
    public async Task A_finished_job_spends_exactly_one_trial_however_often_it_is_polled()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);
        var firstStamp = h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc;

        h.Clock.UtcNow = Now.AddMinutes(5);
        await Poll(h, user, jobId, api);
        await Poll(h, user, jobId, api);

        var job = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(job.TrialConsumedAtUtc);
        Assert.Equal(firstStamp, job.TrialConsumedAtUtc); // the later polls did not re-stamp it
    }

    [Fact]
    public async Task A_job_that_fails_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Failed;
        await Poll(h, user, jobId, api);

        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_job_still_running_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Processing;
        await Poll(h, user, jobId, api);

        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_pro_accounts_finished_job_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);

        // Left unspent on purpose: if this subscription lapses next year, these jobs must not already
        // have eaten the five free ones.
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task Polling_a_job_belonging_to_someone_else_is_a_not_found()
    {
        using var h = new TestHarness(Now);
        var owner = Seed(h);
        var stranger = Seed(h, "nosy@example.com");
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };
        var jobId = (await Submit(h, owner, api)).Value;

        var result = await Poll(h, stranger, jobId, api);

        // NotFound, not Forbidden: confirming the id exists is itself the leak.
        Assert.True(result.IsFailure);
        Assert.Equal("TRANS_JOB_NOT_FOUND", result.Error.Code);
        Assert.Equal(0, api.PollCount); // and the ML service was never asked
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_job_with_no_row_is_let_through_unspent()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };

        // Submitted before this table existed — in flight across the deploy. Breaking it would be the
        // worse trade than letting one transcription through free.
        var result = await Poll(h, user, "job-from-before", api);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Db.TranscriptionJobs);
    }

    // ---------------------------------------------------------------- fixtures

    private static User Seed(TestHarness h, string email = "free@example.com")
    {
        var user = User.Create("Free User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack,
            Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    /// <summary>Records <paramref name="count"/> already-successful generations against the account.</summary>
    private static void Spend(TestHarness h, User user, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.Record($"spent-{user.Id}-{i}", user.Id, Now.AddDays(-10));
            job.ConsumeTrial(Now.AddDays(-10));
            h.Db.TranscriptionJobs.Add(job);
        }

        h.Db.SaveChanges();
    }

    private static Task<Result<string>> Submit(TestHarness h, User user, FakeTranscriptionApi? api = null)
        => new SubmitTranscriptionCommandHandler(
                api ?? new FakeTranscriptionApi(), h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(
                new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, string jobId, FakeTranscriptionApi api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    /// <summary>
    /// Stands in for the Python worker. The status is the test's to set, which is the whole point: in
    /// production it is the ML service's answer, so neither the client nor the handler can invent it.
    /// </summary>
    private sealed class FakeTranscriptionApi : ITranscriptionApi
    {
        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public int PollCount { get; private set; }

        public Task<Result<string>> SubmitAsync(
            Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success($"job-{++_next}"));

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            PollCount++;
            var progress = Status == TranscriptionStatus.Done ? 1d : 0.5d;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, progress, null)));
        }
    }
}
