using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

public class KeyCorrectionsTests
{
    private static readonly DateTime Now = new(2026, 10, 12, 10, 0, 0, DateTimeKind.Utc);

    private static readonly int[] Tune = [67, 69, 71, 72, 74, 72, 71, 69, 67];

    [Fact]
    public async Task A_doh_the_user_changed_is_counted_and_one_the_prompt_offered_is_marked()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Singer", "singer@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.Add(user);

        // Heard as C (unsure, G offered); kept as G.
        Save(h, user.Id, "j-offered", Heard("C major", 0.3, Tune, ["G major"]), new MusicalKey(7, KeyMode.Major), Tune, Now.AddDays(-1));
        // Heard as D and kept as D, then transposed up a tone: E, but the same doh.
        Save(h, user.Id, "j-moved", Heard("D major", 0.9, Tune), new MusicalKey(4, KeyMode.Major), Tune.Select(p => p + 2).ToArray(), Now.AddDays(-2));
        // Heard as A minor, kept as C major: the same doh, only the mode changed.
        Save(h, user.Id, "j-mode", Heard("A minor", 0.6, Tune), new MusicalKey(0, KeyMode.Major), Tune, Now.AddDays(-3));
        // Heard as F, changed to D, which nothing offered.
        Save(h, user.Id, "j-wrong", Heard("F major", 0.8, Tune), new MusicalKey(2, KeyMode.Major), Tune, Now.AddDays(-4));
        await h.Db.SaveChangesAsync();

        var result = await new GetKeyCorrectionsQueryHandler(h.Db, h.Clock).Handle(new GetKeyCorrectionsQuery(IncludeRows: true), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var report = result.Value;
        Assert.Equal(4, report.Sheets);
        Assert.Equal(2, report.DohChanged);
        Assert.Equal(1, report.Offered);
        Assert.Equal(1, report.ChangedToAnOfferedDoh);

        var offered = report.Rows.Single(r => r.DetectedKey == "C major");
        Assert.True(offered.DohChanged && offered.KeptOfferedDoh);
        Assert.Equal(["G major"], offered.OfferedKeys);
        Assert.Equal(Tune, offered.HeardNotes.Select(n => n.Pitch));

        var moved = report.Rows.Single(r => r.DetectedKey == "D major");
        Assert.Equal(2, moved.Transposed);
        Assert.False(moved.DohChanged);

        Assert.False(report.Rows.Single(r => r.DetectedKey == "A minor").DohChanged);
        var wrong = report.Rows.Single(r => r.DetectedKey == "F major");
        Assert.True(wrong.DohChanged && !wrong.KeptOfferedDoh);

        // The console asks for the counts alone.
        var counts = (await new GetKeyCorrectionsQueryHandler(h.Db, h.Clock).Handle(new GetKeyCorrectionsQuery(), CancellationToken.None)).Value;
        Assert.Equal((4, 2), (counts.Sheets, counts.DohChanged));
        Assert.Empty(counts.Rows);
    }

    [Fact]
    public async Task Only_recent_sheets_from_their_owners_own_jobs_are_read()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Singer", "singer@example.com", h.Hasher.Hash("pass"), Now);
        var other = User.Create("Other", "other@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.AddRange(user, other);

        Save(h, user.Id, "j-old", Heard("C major", 0.9, Tune), new MusicalKey(7, KeyMode.Major), Tune, Now.AddDays(-40));
        // A sheet naming someone else's job is not that job's result.
        var job = TranscriptionJob.Record("j-theirs", other.Id, Now.AddDays(-1));
        job.Settle(TranscriptionResultCache.Serialize(Heard("C major", 0.9, Tune)), Now.AddDays(-1));
        h.Db.TranscriptionJobs.Add(job);
        var theirs = Sheet(user.Id, "j-theirs", new MusicalKey(7, KeyMode.Major), Tune);
        h.Db.Transcriptions.Add(theirs);
        h.Db.Entry(theirs).Property(t => t.CreatedAtUtc).CurrentValue = Now.AddDays(-1);
        await h.Db.SaveChangesAsync();

        var result = await new GetKeyCorrectionsQueryHandler(h.Db, h.Clock).Handle(new GetKeyCorrectionsQuery(Days: 30), CancellationToken.None);

        Assert.Equal(0, result.Value.Sheets);
    }

    private static void Save(TestHarness h, Guid userId, string jobId, TranscriptionResultDto heard, MusicalKey kept, int[] keptPitches, DateTime at)
    {
        var job = TranscriptionJob.Record(jobId, userId, at);
        job.Settle(TranscriptionResultCache.Serialize(heard), at);
        h.Db.TranscriptionJobs.Add(job);
        var sheet = Sheet(userId, jobId, kept, keptPitches);
        h.Db.Transcriptions.Add(sheet);
        // A sheet takes the wall clock when it is made; the query reads it against the test's.
        h.Db.Entry(sheet).Property(t => t.CreatedAtUtc).CurrentValue = at;
    }

    private static Transcription Sheet(Guid userId, string jobId, MusicalKey key, int[] pitches)
        => new(userId, "Sheet", key, 90, "4/4", "<score/>",
            pitches.Select((p, i) => new NoteEvent { PitchMidi = p, StartBeat = i, DurationBeats = 1, Confidence = 0.9 }),
            0.8, jobId);

    private static TranscriptionResultDto Heard(string key, double confidence, int[] pitches, string[]? offered = null)
        => new(key, confidence, 90, "4/4", "<score/>", "",
            pitches.Select((p, i) => new NoteEventDto(p, i, 1, 1, "d", "", 0.9)).ToList(), [], 0.8,
            KeyAlternatives: offered?.Select(k => new KeyAlternativeDto(k, pitches)).ToList());
}
