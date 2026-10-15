using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Common;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Library;

/// <summary>
/// A double tap on Save, or the auto-save sweep landing at the same moment as the user's own Save, used to
/// leave two sheets for one job: each request saw "nothing saved for this job yet" before either inserted.
/// Each request here has its own context against one database file, as in production.
/// </summary>
public sealed class ConcurrentSaveTests : IDisposable
{
    private const int Parallel = 6;
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    private readonly string _path = Path.Combine(Path.GetTempPath(), $"nf-save-{Guid.NewGuid():N}.db");
    private readonly InProcessQuotaGate _gate = new();
    private readonly FixedClock _clock = new(Now);

    public ConcurrentSaveTests()
    {
        using var db = Open();
        db.Database.EnsureCreated();
        db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");
    }

    [Fact]
    public async Task Saves_of_one_job_sent_together_leave_one_sheet()
    {
        var userId = SeedUser();

        using var start = new ManualResetEventSlim();
        var tasks = Enumerable.Range(0, Parallel)
            .Select(i => Task.Run(async () =>
            {
                start.Wait();
                await using var db = Open();
                return await new SaveTranscriptionCommandHandler(db, new StubCurrentUser(userId), _gate)
                    .Handle(Command($"Take {i}"), default);
            }))
            .ToArray();
        start.Set();
        var results = await Task.WhenAll(tasks);

        Assert.All(results, r => Assert.True(r.IsSuccess));
        await using var check = Open();
        Assert.Equal(1, await check.Transcriptions.CountAsync(t => t.SourceJobId == "job-1"));
        Assert.Equal(0, _gate.ActiveKeys);
    }

    [Fact]
    public async Task The_sweep_and_a_save_of_the_same_job_together_leave_one_sheet()
    {
        var userId = SeedUser();
        await using (var db = Open())
        {
            var job = TranscriptionJob.Record("job-1", userId, Now.AddHours(-2));
            job.Settle(Application.Transcriptions.TranscriptionResultCache.Serialize(Result()), Now.AddHours(-2).AddMinutes(1));
            db.TranscriptionJobs.Add(job);
            await db.SaveChangesAsync();
        }

        using var start = new ManualResetEventSlim();
        var save = Task.Run(async () =>
        {
            start.Wait();
            await using var db = Open();
            return (await new SaveTranscriptionCommandHandler(db, new StubCurrentUser(userId), _gate)
                .Handle(Command("Mine"), default)).IsSuccess;
        });
        var sweep = Task.Run(async () =>
        {
            start.Wait();
            await using var db = Open();
            return (await new AutoSaveFinishedTranscriptionsCommandHandler(db, _clock, _gate)
                .Handle(new AutoSaveFinishedTranscriptionsCommand(), default)).IsSuccess;
        });
        start.Set();

        Assert.True(await save);
        Assert.True(await sweep);
        await using var check = Open();
        Assert.Equal(1, await check.Transcriptions.CountAsync(t => t.SourceJobId == "job-1"));
    }

    private static SaveTranscriptionCommand Command(string title)
    {
        var r = Result();
        return new SaveTranscriptionCommand(title, r.Key, r.Tempo, r.TimeSignature, r.MusicXml, r.Notes, r.OverallConfidence, "job-1");
    }

    private static TranscriptionResultDto Result()
        => new("G major", 0.9, 96, "4/4", "<score/>", "",
            [new NoteEventDto(67, 0, 1, 1, "d", "", 0.9), new NoteEventDto(69, 1, 1, 2, "r", "", 0.9)],
            ["d r"], 0.8);

    private Guid SeedUser()
    {
        using var db = Open();
        var user = User.Create("Ada", "ada@example.com", "hash", Now.AddDays(-1));
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private ApplicationDbContext Open()
        => new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite($"Data Source={_path};Default Timeout=30;Pooling=False")
            .Options);

    public void Dispose()
    {
        foreach (var file in new[] { _path, _path + "-wal", _path + "-shm" })
        {
            try { File.Delete(file); } catch (IOException) { }
        }
    }
}
