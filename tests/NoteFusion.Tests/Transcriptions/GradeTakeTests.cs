using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>Sing-along grading is Pro, and the API only forwards: nothing about a take is stored.</summary>
public class GradeTakeTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private static readonly GradeTargetDto Target = new([new(60, 0, 1), new(64, 1, 1)], 100, 2.4);

    [Fact]
    public async Task A_free_account_is_told_grading_is_pro()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target), default);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_PRO_REQUIRED", result.Error.Code);
        Assert.Null(api.LastTarget);
    }

    [Fact]
    public async Task A_pro_take_is_forwarded_with_its_part_and_the_marks_come_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(Target, api.LastTarget);
        Assert.Equal("take.m4a", api.LastFileName);
        Assert.Equal(100, result.Value.Score);
        Assert.Equal(2, result.Value.Hits);
        Assert.Empty(h.Db.TranscriptionJobs); // nothing was recorded
    }

    private static GradeTakeCommandHandler Handler(TestHarness h, User user, ITranscriptionApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock);

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "alto@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private sealed class RecordingApi : ITranscriptionApi
    {
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        public GradeTargetDto? LastTarget { get; private set; }
        public string? LastFileName { get; private set; }

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
        {
            LastTarget = target;
            LastFileName = fileName;
            return Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 4.0, 0.12, 0, "Spot on.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 4.0, "hit")).ToList())));
        }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
