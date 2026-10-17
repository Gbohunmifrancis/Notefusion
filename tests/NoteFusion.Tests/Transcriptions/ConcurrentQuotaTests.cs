using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Services;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Common;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// Every allowance is counted from job rows that are written only after the worker accepts the job, so
/// requests sent together used to all count the same rows and all pass. These send them together for
/// real — each on its own <see cref="ApplicationDbContext"/>, as each HTTP request has, against one
/// database, with a worker slow enough that the requests overlap — and expect exactly the allowance.
/// </summary>
public sealed class ConcurrentQuotaTests : IDisposable
{
    private const int Parallel = 8;
    private const string Link = "https://youtu.be/dQw4w9WgXcQ";
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    private readonly string _path = Path.Combine(Path.GetTempPath(), $"nf-quota-{Guid.NewGuid():N}.db");
    private readonly FixedClock _clock = new(Now);
    private readonly InProcessQuotaGate _gate = new();
    private readonly SlowApi _api = new();

    public ConcurrentQuotaTests()
    {
        using var db = Open();
        db.Database.EnsureCreated();
        db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");
    }

    [Fact]
    public async Task Eight_free_submits_at_once_get_exactly_the_three()
    {
        var user = SeedUser();

        var results = await Together(async () =>
        {
            await using var db = Open();
            return await new SubmitTranscriptionCommandHandler(
                    _api, db, new StubCurrentUser(user), _clock, new StubDeviceFingerprint("phone-a"),
                    Recorder(db), Activity(db, user), _gate)
                .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null), default);
        });

        Assert.Equal(FreeTier.TrialGenerationsFor("NG"), results.Count(r => r.IsSuccess));
        Assert.All(results.Where(r => r.IsFailure), r => Assert.Equal("BILLING_FREE_TIER_LIMIT", r.Error.Code));
        await using var check = Open();
        Assert.Equal(3, await check.TranscriptionJobs.CountAsync());
        Assert.Equal(1, await check.TrialDevices.CountAsync());
        Assert.Equal(0, _gate.ActiveKeys); // nothing is kept per key once the requests are done
    }

    [Fact]
    public async Task Aliases_of_one_inbox_submitting_at_once_from_different_devices_get_the_three_between_them()
    {
        // Each request is its own alias of one Gmail inbox on its own device, so neither the account key nor
        // the device key serialises them: only the inbox's does.
        var aliases = Enumerable.Range(0, Parallel).Select(i => SeedUser(email: $"sam+{i}@gmail.com")).ToArray();
        var next = -1;

        var results = await Together(async () =>
        {
            var i = Interlocked.Increment(ref next);
            await using var db = Open();
            return await new SubmitTranscriptionCommandHandler(
                    _api, db, new StubCurrentUser(aliases[i]), _clock, new StubDeviceFingerprint($"window-{i}"),
                    Recorder(db), Activity(db, aliases[i]), _gate)
                .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null), default);
        });

        Assert.Equal(3, results.Count(r => r.IsSuccess));
        Assert.All(results.Where(r => r.IsFailure), r => Assert.Equal("BILLING_FREE_TIER_LIMIT", r.Error.Code));
        await using var check = Open();
        Assert.Equal(3, await check.TranscriptionJobs.CountAsync());
        Assert.Equal(0, _gate.ActiveKeys);
    }

    [Fact]
    public async Task Eight_pro_songs_at_once_are_capped_at_three_in_progress()
    {
        var user = SeedUser(pro: true);

        var results = await Together(async () =>
        {
            await using var db = Open();
            return await new SubmitLinkTranscriptionCommandHandler(
                    _api, db, new StubCurrentUser(user), _clock, new StubDeviceFingerprint(null), Activity(db, user), _gate)
                .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null), default);
        });

        Assert.Equal(SongCredits.ProMaxSongsInProgress, results.Count(r => r.IsSuccess));
        Assert.All(results.Where(r => r.IsFailure), r =>
        {
            Assert.Equal("BILLING_SONGS_IN_PROGRESS", r.Error.Code);
            Assert.Equal("You have 3 songs in progress. Wait for one to finish, then try again.", r.Error.Message);
        });
    }

    [Fact]
    public async Task Eight_previews_from_one_browser_at_once_get_one()
    {
        var results = await Together(async () =>
        {
            await using var db = Open();
            return await new SubmitPreviewCommandHandler(
                    _api, db, _clock, new StubDeviceFingerprint("browser-a"), new StubClientIpAddress("203.0.113.9"),
                    Activity(db, null), _gate)
                .Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);
        });

        Assert.Single(results, r => r.IsSuccess);
        await using var check = Open();
        Assert.Equal(1, await check.PreviewJobs.CountAsync());
    }

    [Fact]
    public async Task Eight_free_harmonies_at_once_get_the_one()
    {
        var user = SeedUser();
        NoteEventDto[] tune = [new(60, 0, 1, 1, "d", "", 1), new(62, 1, 1, 2, "r", "", 1)];

        var results = await Together(async () =>
        {
            await using var db = Open();
            return await new HarmoniseSheetCommandHandler(_api, db, new StubCurrentUser(user), _clock, _gate)
                .Handle(new HarmoniseSheetCommand("C major", 100, "4/4", tune), default);
        });

        Assert.Single(results, r => r.IsSuccess);
        Assert.All(results.Where(r => r.IsFailure), r => Assert.Equal("BILLING_PRO_REQUIRED", r.Error.Code));
        Assert.Equal(1, _api.Harmonised);
    }

    [Fact]
    public async Task A_cancelled_wait_leaves_the_key_free()
    {
        var held = await _gate.AcquireAsync("user:x");
        using var cts = new CancellationTokenSource();
        var waiting = _gate.AcquireAsync("user:x", cts.Token);
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);

        await held.DisposeAsync();
        await (await _gate.AcquireAsync("user:x")).DisposeAsync();
        Assert.Equal(0, _gate.ActiveKeys);
    }

    [Fact]
    public async Task Two_accounts_registering_one_handset_at_once_both_submit()
    {
        var first = SeedUser();
        var second = SeedUser();
        await using var db = Open();
        // The other account's request registers the handset between this one's read and its insert —
        // exactly while this one is out asking where the handset is.
        var racing = new RacingCountry(() =>
        {
            using var other = Open();
            other.TrialDevices.Add(TrialDevice.Register("phone-a", "GB", null, Now));
            other.TranscriptionJobs.Add(TranscriptionJob.Record("other-job", second, Now, "phone-a"));
            other.SaveChanges();
        });
        var recorder = new TrialDeviceRecorder(db, racing, new StubClientIpAddress(), _clock, NullLogger<TrialDeviceRecorder>.Instance);

        var result = await new SubmitTranscriptionCommandHandler(
                _api, db, new StubCurrentUser(first), _clock, new StubDeviceFingerprint("phone-a"), recorder, Activity(db, first), _gate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1]), "clip.m4a", TranscriptionMode.Melody, null, null), default);

        // The unique index refused the second insert; that used to surface as a 500 from the submit.
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : "");
        await using var check = Open();
        var device = Assert.Single(check.TrialDevices);
        Assert.Equal("GB", device.FirstSeenCountry);
        Assert.Equal(2, await check.TranscriptionJobs.CountAsync(j => j.DeviceFingerprint == "phone-a"));
    }

    // ---------------------------------------------------------------- fixtures

    private sealed class RacingCountry(Action meanwhile) : ICountryResolver
    {
        public Task<string?> ResolveAsync(CancellationToken ct = default)
        {
            meanwhile();
            return Task.FromResult<string?>("NG");
        }
    }

    private static async Task<Result<T>[]> Together<T>(Func<Task<Result<T>>> request)
    {
        using var start = new ManualResetEventSlim();
        var tasks = Enumerable.Range(0, Parallel)
            .Select(_ => Task.Run(async () =>
            {
                start.Wait();
                return await request();
            }))
            .ToArray();
        start.Set();
        return await Task.WhenAll(tasks);
    }

    private ApplicationDbContext Open()
        => new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite($"Data Source={_path};Default Timeout=30")
            .Options);

    private TrialDeviceRecorder Recorder(ApplicationDbContext db)
        => new(db, new StubCountryResolver(), new StubClientIpAddress(), _clock, NullLogger<TrialDeviceRecorder>.Instance);

    private ActivityRecorder Activity(ApplicationDbContext db, Guid? user)
        => new(db, _clock, new StubDeviceFingerprint(null), new StubClientApp(), new StubCurrentUser(user));

    private Guid SeedUser(bool pro = false, string? email = null)
    {
        using var db = Open();
        var user = User.Create("Free User", email ?? $"u-{Guid.NewGuid():N}@example.com", "hash", Now.AddDays(-30));
        user.RecordCountry("NG");
        db.Users.Add(user);
        if (pro)
        {
            var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
            db.Plans.Add(plan);
            db.Subscriptions.Add(Subscription.Start(
                user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        }
        db.SaveChanges();
        return user.Id;
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        foreach (var file in new[] { _path, _path + "-wal", _path + "-shm" })
        {
            try { File.Delete(file); } catch (IOException) { /* a temp file; the OS will have it */ }
        }
    }

    /// <summary>A worker slow enough to answer that every request overlaps every other.</summary>
    private sealed class SlowApi : ITranscriptionApi
    {
        private int _next;
        private int _harmonised;

        public int Harmonised => _harmonised;

        private async Task<Result<string>> AcceptAsync(CancellationToken ct)
        {
            await Task.Delay(100, ct);
            return Result<string>.Success($"job-{Interlocked.Increment(ref _next)}");
        }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => AcceptAsync(ct);

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => AcceptAsync(ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => AcceptAsync(ct);

        public async Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
        {
            await Task.Delay(100, ct);
            Interlocked.Increment(ref _harmonised);
            return new HarmonyDto(new Dictionary<string, PartDto> { ["bass"] = new PartDto(notes, ["d r"]) }, "<satb/>");
        }

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
            => Task.FromResult(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(jobId, TranscriptionStatus.Pending, 0, null)));

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default)
            => Task.FromResult(Result<int>.Success(1));
    }
}
