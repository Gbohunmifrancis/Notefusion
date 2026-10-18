using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Practice;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Flags;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The Christmas words in pushes: Doh's festive reminder lines and the product's "ready" lines, each fitting a phone
/// notification at its worst case; joining the usual rotation only while the season is on for everyone (an admin's
/// preview never changes a push); and never festive about a lapse, a freeze or a goodbye.
/// </summary>
public class ChristmasPushTests
{
    /// <summary>"Angels from the Realms of Glory": the longest carol title, the boards' worst case.</summary>
    private const string LongestCarol = "Angels from the Realms of Glory";

    // ── Practice reminders ───────────────────────────────────────────────────

    [Fact]
    public void Every_christmas_reminder_fits_a_phone_notification_with_a_four_digit_streak_and_the_longest_carol()
    {
        Assert.Equal(31, LongestCarol.Length);
        Assert.All(CarolPath.Drills, d => Assert.True(d.Carol.Length <= LongestCarol.Length, d.Carol));

        var lines = PracticeReminderCopy.ChristmasPlayful.Concat(PracticeReminderCopy.ChristmasPlain).ToList();
        Assert.Equal(6, lines.Sum(l => l.Value.Count));
        foreach (var (kind, variants) in lines)
        {
            foreach (var line in variants)
            {
                foreach (var streak in new[] { 0, 1, 9, 99, 999, 9999 })
                {
                    var title = Fill(line.Title, streak, LongestCarol);
                    var body = Fill(line.Body, streak, LongestCarol);
                    Assert.True(title.Length <= PracticeReminderCopy.MaxTitleLength, $"{kind} title too long: {title}");
                    Assert.True(body.Length <= PracticeReminderCopy.MaxBodyLength, $"{kind} body too long: {body}");
                    Assert.True(title.Length <= PracticeReminder.TitleMaxLength && body.Length <= PracticeReminder.BodyMaxLength);
                }
            }
        }

        // Doh speaks to Playful; Focused is plain.
        Assert.All(PracticeReminderCopy.ChristmasPlain.Values.SelectMany(v => v), t => Assert.DoesNotContain("Doh", t.Title + t.Body));
    }

    [Fact]
    public void The_festive_lines_join_the_rotation_only_in_season_and_never_for_a_lapse_a_freeze_or_a_goodbye()
    {
        foreach (var kind in Enum.GetValues<PracticeReminderKind>())
        {
            foreach (var track in new PracticeTrack?[] { PracticeTrack.Playful, PracticeTrack.Focused, null })
            {
                var usual = PracticeReminderCopy.VariantsFor(kind, track);
                Assert.Equal(usual, PracticeReminderCopy.VariantsFor(kind, track, christmas: false, "Silent Night"));
                var festive = PracticeReminderCopy.VariantsFor(kind, track, christmas: true, "Silent Night");
                Assert.Equal(usual, festive.Take(usual.Count)); // the usual lines stay, in their order
                if (kind is PracticeReminderKind.FreezeReady or PracticeReminderKind.StreakLost or PracticeReminderKind.Final)
                    Assert.Equal(usual, festive);
            }
        }

        Assert.Equal(4, PracticeReminderCopy.VariantsFor(PracticeReminderKind.LearningWaiting, PracticeTrack.Playful, true, "Silent Night").Count);
        // No next carol (all six sung): a line naming one stays out.
        Assert.Equal(3, PracticeReminderCopy.VariantsFor(PracticeReminderKind.LearningWaiting, PracticeTrack.Playful, true, carol: null).Count);
        Assert.Equal(new ReminderText("Silent Night is waiting 🎵", "Doh has your next carol drill ready. Two minutes of singing, then back to the celebrations!"),
            PracticeReminderCopy.For(PracticeReminderKind.LearningWaiting, PracticeTrack.Playful, 0, 3, christmas: true, "Silent Night"));
        Assert.Equal(new ReminderText("Keep your 12-day streak this Christmas", "One short carol drill before midnight keeps it going."),
            PracticeReminderCopy.For(PracticeReminderKind.StreakAtRisk, PracticeTrack.Focused, 12, 3, christmas: true, null));
    }

    [Fact]
    public async Task In_season_the_reminder_comes_from_the_festive_rotation_and_names_the_next_carol()
    {
        // A Focused singer who practised yesterday (a one-day streak: Ordinary) and has passed the first two carols.
        var (h, singer, day) = await SingerDueOn(track: PracticeTrack.Focused, kind: PracticeReminderKind.Ordinary, festiveIndex: 2, variants: 3);
        using var _ = h;
        foreach (var definition in CarolPath.Drills.Take(2))
            Take(h, singer, day.AddDays(-1), CarolPath.Build(definition).Drill.Id);
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));

        Assert.Equal(1, await Run(h));

        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal(PracticeReminderKind.Ordinary, row.Kind);
        Assert.Equal(("Today's carol drill is ready", "Silent Night: about two minutes. Practise today to make it 2 days in a row."), (row.Title, row.Body));
        Assert.Equal(row.Title, Assert.Single(h.Push.DeviceSends).Message.Title);
    }

    [Fact]
    public async Task An_admins_preview_and_an_ended_season_leave_the_reminders_usual()
    {
        var (h, singer, day) = await SingerDueOn(track: PracticeTrack.Playful, kind: PracticeReminderKind.Ordinary, festiveIndex: 3, variants: 4);
        using var _ = h;
        SeasonFlagTests.SetFlag(h, enabled: false, preview: true, lastDay: new DateOnly(2027, 1, 6));

        Assert.Equal(1, await Run(h));

        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        var rotation = PracticeReminderCopy.Rotation(singer, day, PracticeReminderSlot.Daily);
        Assert.Equal(PracticeReminderCopy.For(PracticeReminderKind.Ordinary, PracticeTrack.Playful, 1, rotation), new ReminderText(row.Title, row.Body));
        Assert.DoesNotContain("carol", row.Title + row.Body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Doh_warms_up_for_carols_for_a_playful_singer_in_season()
    {
        var (h, _, _) = await SingerDueOn(track: PracticeTrack.Playful, kind: PracticeReminderKind.Ordinary, festiveIndex: 3, variants: 4);
        using var _h = h;
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));

        Assert.Equal(1, await Run(h));

        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal(("Doh's warming up for carols 🎄", "A carol drill is ready! Two minutes of singing makes it 2 days in a row."), (row.Title, row.Body));
    }

    // ── "Your sheet is ready" ────────────────────────────────────────────────

    [Fact]
    public void Every_ready_line_fits_with_a_long_name_the_longest_key_and_a_three_figure_tempo()
    {
        var result = Done("C# minor", 240, hymn: null);
        var ready = ReadyPushCopy.Christmas("Oluwaseyifunmi", result); // 14 letters
        Assert.Equal(("Hey Oluwaseyifunmi, your sheet is ready 🎄", "C# minor · 240 BPM — tap to review and save it. Merry Christmas!"), (ready.Title, ready.Body));

        var known = ReadyPushCopy.Christmas("Oluwaseyifunmi", Done("C# minor", 240, Hymn(LongestCarol, "score")));
        Assert.Equal(("Hey Oluwaseyifunmi, we know this one 🎄", $"It sounds like {LongestCarol}. Tap to see your take beside the hymnbook's."), (known.Title, known.Body));

        foreach (var text in new[] { ready, known })
        {
            Assert.True(text.Title.Length <= ReadyPushCopy.MaxTitleLength, text.Title);
            Assert.True(text.Body.Length <= ReadyPushCopy.MaxBodyLength, text.Body);
        }

        // A name too long for the title is left out; a hymn title too long for the body gives the plain ready line.
        Assert.Equal("Hey there, your sheet is ready 🎄", ReadyPushCopy.Christmas("Bartholomew-Adebayo-Johnson", result).Title);
        var tooLong = ReadyPushCopy.Christmas("Ada", Done("G major", 96, Hymn(new string('x', 70), "score")));
        Assert.Equal("Hey Ada, your sheet is ready 🎄", tooLong.Title);
        // Recognised by its opening only (no hymnbook version to compare with): the ready line.
        Assert.Equal("Hey Ada, your sheet is ready 🎄", ReadyPushCopy.Christmas("Ada", Done("G major", 96, Hymn("Silent Night", "incipit"))).Title);
    }

    [Fact]
    public async Task In_season_the_ready_push_is_festive_on_the_phone_and_the_web_alike()
    {
        using var h = new TestHarness(new DateTime(2026, 12, 19, 18, 0, 0, DateTimeKind.Utc));
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));
        var user = User.Create("Francis Gbohunmi", "francis@example.com", "hash", h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, h.Clock.UtcNow.AddMinutes(-2));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();

        await Notify(h, job, Done("Bb major", 78, Hymn("Silent Night", "score")));

        var push = Assert.Single(h.Push.Sent).Message;
        Assert.Equal(("Hey Francis, we know this one 🎄", "It sounds like Silent Night. Tap to see your take beside the hymnbook's."), (push.Title, push.Body));
        var web = Assert.Single(h.WebPush.Sent).Notification;
        Assert.Equal((push.Title, push.Body), (web.Title, web.Body));
        Assert.Equal("nf-job-job-1", web.Tag);
    }

    [Fact]
    public async Task Out_of_season_or_in_an_admins_preview_the_ready_push_is_the_usual_one()
    {
        using var h = new TestHarness(new DateTime(2026, 12, 19, 18, 0, 0, DateTimeKind.Utc));
        SeasonFlagTests.SetFlag(h, enabled: false, preview: true, lastDay: new DateOnly(2027, 1, 6));
        var user = User.Create("Francis Gbohunmi", "francis@example.com", "hash", h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, h.Clock.UtcNow.AddMinutes(-2));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();

        await Notify(h, job, Done("Bb major", 78, Hymn("Silent Night", "score")));

        Assert.Equal("Hey Francis, your transcription is ready!", Assert.Single(h.Push.Sent).Message.Title);
        Assert.Equal("Your sheet is ready", Assert.Single(h.WebPush.Sent).Notification.Title);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string Fill(string template, int streak, string carol)
        => template.Replace("{next}", (streak + 1).ToString()).Replace("{n}", streak.ToString()).Replace("{carol}", carol);

    /// <summary>
    /// A singer on <paramref name="track"/> who practised the day before, due their evening reminder on a December day
    /// whose rotation lands on the <paramref name="festiveIndex"/>th of <paramref name="variants"/> lines (where the
    /// festive one joins), with the clock at 19:00 in Lagos.
    /// </summary>
    private static async Task<(TestHarness H, Guid Singer, DateOnly Day)> SingerDueOn(PracticeTrack track, PracticeReminderKind kind, int festiveIndex, int variants)
    {
        var h = new TestHarness(new DateTime(2026, 12, 1, 9, 0, 0, DateTimeKind.Utc));
        var user = User.Create("Singer", "singer@example.com", "hash", new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc));
        h.Db.Users.Add(user);
        user.RegisterDeviceToken($"ExponentPushToken[{user.Id:N}]", "android", 30, h.Clock.UtcNow, serverReminders: true);
        user.ChoosePracticeTrack(track, h.Clock.UtcNow);
        h.Db.SaveChanges();

        var day = Enumerable.Range(0, variants).Select(d => new DateOnly(2026, 12, 10).AddDays(d))
            .First(d => PracticeReminderCopy.Rotation(user.Id, d, PracticeReminderSlot.Daily) % variants == festiveIndex);
        Take(h, user.Id, day.AddDays(-1), "steps-up@60");
        h.Clock.UtcNow = day.ToDateTime(new TimeOnly(18, 0), DateTimeKind.Utc); // 19:00 in Lagos
        Assert.Equal(kind, Assert.Single(await new PracticeReminderService(h.Db, h.Clock, h.Push).FindDueAsync(10, default)).Due.Kind);
        return (h, user.Id, day);
    }

    private static void Take(TestHarness h, Guid userId, DateOnly day, string drillId)
    {
        h.Db.PracticeSessions.Add(PracticeSession.Record(
            userId, PracticeKind.Drill, 90, 3, 0, 0, 0, 4, day.ToDateTime(new TimeOnly(11, 0), DateTimeKind.Utc), day, drillId: drillId));
        h.Db.SaveChanges();
    }

    private static Task<int> Run(TestHarness h)
        => new PracticeReminderRunner(h.Db, new PracticeReminderService(h.Db, h.Clock, h.Push), new PracticeReminderSettings(),
            NullLogger<PracticeReminderRunner>.Instance).RunAsync(default);

    private static TranscriptionResultDto Done(string key, int tempo, HymnMatchDto? hymn) => new(
        key, 0.9, tempo, "4/4", "<score-partwise version=\"4.0\" />", "",
        [new NoteEventDto(67, 0, 1, 5, "s", "", 0.95)], ["s"], 0.9, "", HymnMatch: hymn);

    private static HymnMatchDto Hymn(string title, string kind)
        => new("silent-night", title, "STILLE NACHT", "https://notefusion.studio/hymns/silent-night", "", "", "", kind, 0.9);

    private static async Task Notify(TestHarness h, TranscriptionJob job, TranscriptionResultDto result)
    {
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>())
            .Returns(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, result)));
        var notifier = Substitute.For<ITranscriptionNotifier>();
        var done = await new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, notifier, h.WebPush)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), default);
        Assert.True(done.IsSuccess);
    }
}
