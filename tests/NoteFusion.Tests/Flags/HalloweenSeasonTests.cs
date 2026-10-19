using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Flags;
using NoteFusion.Application.Flags.Commands;
using NoteFusion.Application.Flags.Dtos;
using NoteFusion.Application.Flags.Queries;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Flags;

/// <summary>
/// The Halloween season beside Christmas: its own switch, switching itself off after All Saints' Day (1 November) by
/// default; one season at a time (turning one on switches the other off, in the trail); <c>GET /api/app/season</c>
/// saying which; and its words in pushes, fitting a phone at their worst case, never about a lapse or a goodbye.
/// </summary>
public class HalloweenSeasonTests
{
    private static readonly DateTime Now = new(2026, 10, 19, 12, 0, 0, DateTimeKind.Utc);

    // ── The switch ───────────────────────────────────────────────────────────

    [Fact]
    public void Halloween_ends_after_all_saints_day_unless_an_admin_picks_another()
    {
        Assert.Equal(new DateOnly(2026, 11, 1), FeatureFlags.DefaultLastDay(FeatureFlag.Halloween, new DateOnly(2026, 10, 19)));
        Assert.Equal(new DateOnly(2026, 11, 1), FeatureFlags.DefaultLastDay(FeatureFlag.Halloween, new DateOnly(2026, 11, 1)));
        Assert.Equal(new DateOnly(2027, 11, 1), FeatureFlags.DefaultLastDay(FeatureFlag.Halloween, new DateOnly(2026, 11, 2)));
        // Christmas keeps Epiphany.
        Assert.Equal(new DateOnly(2027, 1, 6), FeatureFlags.DefaultLastDay(FeatureFlag.Christmas, new DateOnly(2026, 10, 19)));
    }

    [Fact]
    public async Task Turned_on_it_is_halloween_everywhere_until_the_midnight_after_1_November()
    {
        using var h = new TestHarness(Now);
        var admin = SeasonFlagTests.Seed(h, "admin@example.com", UserRole.Admin);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");

        var flag = (await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Halloween, Enabled: true))).Value;
        Assert.Equal(new DateOnly(2026, 11, 1), flag.AutoOffAt);
        Assert.Equal(new DateTime(2026, 11, 1, 23, 0, 0, DateTimeKind.Utc), flag.AutoOffAtUtc); // 2 Nov, 00:00 WAT

        Assert.Equal(new SeasonDto(Christmas: false, Halloween: true), await Season(h, SeasonFlagTests.Caller(singer)));
        Assert.Equal(new SeasonDto(false, true), await Season(h, new StubCurrentUser()));

        h.Clock.UtcNow = new DateTime(2026, 11, 1, 23, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new SeasonDto(false, false), await Season(h, SeasonFlagTests.Caller(singer)));
    }

    [Fact]
    public async Task One_season_at_a_time_turning_one_on_switches_the_other_off_in_the_trail()
    {
        using var h = new TestHarness(Now);
        var admin = SeasonFlagTests.Seed(h, "admin@example.com", UserRole.Admin);
        await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Christmas, Enabled: true));

        var halloween = (await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Halloween, Enabled: true))).Value;

        Assert.True(halloween.On);
        var christmas = await h.Db.FeatureFlags.AsNoTracking().SingleAsync(f => f.Key == FeatureFlag.Christmas);
        Assert.False(christmas.IsOn(h.Clock.UtcNow));
        Assert.Equal(new SeasonDto(false, true), await Season(h, new StubCurrentUser()));
        var trail = await h.Db.AdminAuditLogs.AsNoTracking().Select(a => a.Summary).ToListAsync();
        Assert.Contains(trail, t => t.StartsWith("Turned the Halloween season on for everyone", StringComparison.Ordinal));
        Assert.Contains(trail, t => t == "Turned the Christmas season off for everyone.");

        // Changing Halloween again (its preview) leaves Christmas alone.
        await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Halloween, AdminPreview: true));
        Assert.Equal(4, await h.Db.AdminAuditLogs.CountAsync());
    }

    [Fact]
    public async Task An_admin_previewing_both_sees_christmas_and_pushes_never_read_a_preview()
    {
        using var h = new TestHarness(Now);
        var admin = SeasonFlagTests.Seed(h, "admin@example.com", UserRole.Admin);
        await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Christmas, AdminPreview: true));
        await Set(h, admin, new SetFeatureFlagCommand(FeatureFlag.Halloween, AdminPreview: true));

        Assert.Equal(new SeasonDto(true, false), await Season(h, SeasonFlagTests.Caller(admin)));
        Assert.Null(await FeatureFlags.SeasonForEveryoneAsync(h.Db, h.Clock.UtcNow, default));
    }

    // ── Pushes ───────────────────────────────────────────────────────────────

    /// <summary>The longest song title on the Midnight path: the boards' worst case.</summary>
    private const string LongestSong = "In the Hall of the Mountain King";

    [Fact]
    public void Every_halloween_reminder_fits_a_phone_notification_with_a_four_digit_streak_and_the_longest_song()
    {
        Assert.All(HalloweenPath.Drills, d => Assert.True(d.Carol.Length <= LongestSong.Length, d.Carol));

        var lines = PracticeReminderCopy.HalloweenPlayful.Concat(PracticeReminderCopy.HalloweenPlain).SelectMany(l => l.Value).ToList();
        Assert.Equal(6, lines.Count);
        foreach (var line in lines)
        {
            foreach (var streak in new[] { 0, 1, 9, 99, 999, 9999 })
            {
                var title = PracticeReminderCopy.For(KindOf(line), TrackOf(line), streak, Rotation(line), FeatureFlag.Halloween, LongestSong).Title;
                var body = PracticeReminderCopy.For(KindOf(line), TrackOf(line), streak, Rotation(line), FeatureFlag.Halloween, LongestSong).Body;
                Assert.True(title.Length <= PracticeReminderCopy.MaxTitleLength, $"title too long: {title}");
                Assert.True(body.Length <= PracticeReminderCopy.MaxBodyLength, $"body too long: {body}");
            }
        }
        var lastNight = PracticeReminderCopy.For(PracticeReminderKind.Ordinary, null, 3, 0, FeatureFlag.Halloween, LongestSong, lastNightLeft: 5);
        Assert.Equal(new ReminderText("Last night of the Midnight path 🕯️", "It closes at midnight. 5 drills left for the Night Singer sticker."), lastNight);
        Assert.True(lastNight.Title.Length <= PracticeReminderCopy.MaxTitleLength);

        // Doh speaks to Playful; Focused is plain.
        Assert.All(PracticeReminderCopy.HalloweenPlain.Values.SelectMany(v => v), t => Assert.DoesNotContain("Doh", t.Title + t.Body));
    }

    [Fact]
    public void The_halloween_lines_join_the_rotation_only_in_season_and_never_for_a_lapse_a_freeze_or_a_goodbye()
    {
        foreach (var kind in Enum.GetValues<PracticeReminderKind>())
        {
            foreach (var track in new PracticeTrack?[] { PracticeTrack.Playful, PracticeTrack.Focused, null })
            {
                var usual = PracticeReminderCopy.VariantsFor(kind, track);
                var spooky = PracticeReminderCopy.VariantsFor(kind, track, FeatureFlag.Halloween, "Dem Bones");
                Assert.Equal(usual, spooky.Take(usual.Count));
                if (kind is PracticeReminderKind.FreezeReady or PracticeReminderKind.StreakLost or PracticeReminderKind.Final)
                    Assert.Equal(usual, spooky);
            }
        }

        Assert.Equal(new ReminderText("Dem Bones is waiting 🦇", "Doh has your next Midnight drill ready. Sing three notes before the bats wake up!"),
            PracticeReminderCopy.For(PracticeReminderKind.LearningWaiting, PracticeTrack.Playful, 0, 3, FeatureFlag.Halloween, "Dem Bones"));
        // The last night's line is for an ordinary or "learning waiting" reminder only, and only at Halloween.
        Assert.NotEqual(PracticeReminderCopy.HalloweenLastNight.Title,
            PracticeReminderCopy.For(PracticeReminderKind.StreakAtRisk, null, 4, 0, FeatureFlag.Halloween, "Dem Bones", lastNightLeft: 2).Title);
        Assert.NotEqual(PracticeReminderCopy.HalloweenLastNight.Title,
            PracticeReminderCopy.For(PracticeReminderKind.Ordinary, null, 4, 0, FeatureFlag.Christmas, "Silent Night", lastNightLeft: 2).Title);
        Assert.Equal("It closes at midnight. 1 drill left for the Night Singer sticker.",
            PracticeReminderCopy.For(PracticeReminderKind.LearningWaiting, null, 4, 0, FeatureFlag.Halloween, "Dem Bones", lastNightLeft: 1).Body);
    }

    [Fact]
    public void The_ready_push_says_all_treat_no_trick_and_fits_with_the_longest_key_and_tempo()
    {
        var result = new TranscriptionResultDto("G# harmonic minor", 0.9, 240, "4/4", "<x/>", "", [], [], 0.9, "");
        var words = ReadyPushCopy.ForSeason(FeatureFlag.Halloween, "Oluwaseyifunmi", result)!;
        Assert.Equal("Hey Oluwaseyifunmi, your sheet is ready 🎃", words.Title);
        Assert.Equal("G# harmonic minor · 240 BPM. All treat, no trick: tap to review and save it.", words.Body);
        Assert.True(words.Title.Length <= ReadyPushCopy.MaxTitleLength && words.Body.Length <= ReadyPushCopy.MaxBodyLength);

        Assert.Contains("Merry Christmas", ReadyPushCopy.ForSeason(FeatureFlag.Christmas, "Ada", result)!.Body);
        Assert.Null(ReadyPushCopy.ForSeason(null, "Ada", result));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// <summary>Where a line sits: its kind, track and rotation, so <see cref="PracticeReminderCopy.For(PracticeReminderKind, PracticeTrack?, int, int, string?, string?, int?)"/> picks it.</summary>
    private static PracticeReminderKind KindOf(ReminderText line)
        => PracticeReminderCopy.HalloweenPlayful.Concat(PracticeReminderCopy.HalloweenPlain).First(l => l.Value.Contains(line)).Key;

    private static PracticeTrack? TrackOf(ReminderText line)
        => PracticeReminderCopy.HalloweenPlain.Values.Any(v => v.Contains(line)) ? PracticeTrack.Focused : PracticeTrack.Playful;

    private static int Rotation(ReminderText line)
        => PracticeReminderCopy.VariantsFor(KindOf(line), TrackOf(line), FeatureFlag.Halloween, LongestSong).ToList().IndexOf(line);

    private static async Task<SeasonDto> Season(TestHarness h, StubCurrentUser caller)
        => (await new GetSeasonQueryHandler(h.Db, h.Clock, caller).Handle(new GetSeasonQuery(), default)).Value;

    private static Task<Result<FeatureFlagDto>> Set(TestHarness h, User admin, SetFeatureFlagCommand command)
    {
        h.Clock.UtcNow = h.Clock.UtcNow.AddSeconds(1);
        return new SetFeatureFlagCommandHandler(h.Db, SeasonFlagTests.Caller(admin), h.AuditAs(admin), h.Clock).Handle(command, default);
    }
}
