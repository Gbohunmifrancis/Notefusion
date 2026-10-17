using System.Globalization;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Reminders;

/// <summary>A reminder's words, as the phone shows them.</summary>
public sealed record ReminderText(string Title, string Body);

/// <summary>
/// Every practice reminder's words, in one place, in the voice of Doh, the practice buddy: warm and a little urgent,
/// never false and never shaming. Playful (and anyone who has not picked a track) hears Doh in person with an emoji;
/// Focused gets the same facts said plainly. Each situation has several variants, rotated by day so the same words
/// do not arrive two days running.
/// </summary>
/// <remarks>
/// <para>
/// <c>{n}</c> is the streak the situation is about (the running one, or the one just lost) and <c>{next}</c> the day
/// practising today would make it. Every variant fits a phone notification with any streak up to four digits:
/// a title of at most <see cref="MaxTitleLength"/> characters and a body of at most <see cref="MaxBodyLength"/>,
/// counted in UTF-16 units so an emoji counts double (the tests check every one).
/// </para>
/// <para>
/// What each may claim is what the rules make true: "ends at midnight" only when no freeze would bridge today
/// (<see cref="PracticeReminderKind.StreakAtRisk"/>, <see cref="PracticeReminderKind.LastChance"/>); "your freeze is
/// ready" only when this week's is unused; XP and badges are kept when a streak ends; and a drill takes about two
/// minutes. "We'll stop reminding you; Practice is here when you want it." is the final one, and it is.
/// </para>
/// </remarks>
public static class PracticeReminderCopy
{
    public const int MaxTitleLength = 50;
    public const int MaxBodyLength = 120;

    /// <summary>Doh's voice: the Playful track, and anyone who has not chosen one.</summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> Playful =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Doh here! Ready to sing? 🎵", "Your streak has begun! Sing today's drill and make it {next} days in a row."),
                new("Day {next} is calling 🎶", "Doh has today's notes ready. Two minutes of singing keeps your new streak going."),
                new("Your voice, today? 🎤", "Hear the pattern, sing it back, done. Doh can't wait to hear you!"),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("🔥 Your {n}-day streak ends at midnight", "Two minutes with today's drill keeps it alive. Doh's ready when you are!"),
                new("Keep the 🔥 going: day {next} awaits!", "Your {n}-day streak needs today's drill. Sing it before midnight and it carries on."),
                new("Doh is cheering for your {n} days 🔥", "Don't let the streak slip tonight! One short drill before midnight keeps it."),
            ],
            [PracticeReminderKind.FreezeReady] =
            [
                new("Your freeze is ready, but… 🧊", "It would cover today if you skip. Sing instead and your streak grows to {next} days! 🎵"),
                new("Save your freeze for a busy day 🧊", "Sing today's drill and your {n}-day streak grows to {next}. The freeze stays ready for later!"),
            ],
            [PracticeReminderKind.LastChance] =
            [
                new("⏰ Last chance for your {n}-day streak", "It ends at midnight. Doh saved you a quick drill: two minutes and it's safe!"),
                new("🔥 {n} days… don't let it go out!", "There's still time tonight. One short drill keeps your streak burning bright."),
            ],
            [PracticeReminderKind.StreakLost] =
            [
                new("Your streak slipped 💛", "Your {n} days still count: your XP and badges are yours. Start a new streak with Doh today?"),
                new("New day, new streak? 🎵", "Your {n}-day streak ended, but every streak starts at day 1. Doh's ready to sing with you!"),
            ],
            [PracticeReminderKind.LearningWaiting] =
            [
                new("Doh misses you 🎵", "Learning is waiting! Today's drill is short and sweet. Come and sing a few notes."),
                new("Your next drill is waiting 🎶", "Doh picked a fresh one for you. Two minutes is all it takes."),
                new("Got two minutes to sing? 🎤", "Your ear gets sharper every time you practise. Doh's ready when you are."),
            ],
            [PracticeReminderKind.Final] =
            [
                new("Doh will stop the reminders 💛", "We'll stop reminding you; Practice is here when you want it. Sing one drill and Doh's back!"),
                new("This is Doh's last reminder 🎵", "We'll stop reminding you; Practice is here when you want it. Doh will be humming till then!"),
            ],
        };

    /// <summary>The Focused track: the same facts, plainly.</summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> Plain =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Today's drill is ready", "A short solfa pattern to hear and sing back. Practise today to make it {next} days in a row."),
                new("Time to practise", "Today's drill takes about two minutes and keeps your new streak going."),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("Your {n}-day streak ends at midnight", "One short drill today keeps it going. It takes about two minutes."),
                new("Day {next} of your streak is waiting", "Practise before midnight to keep your {n}-day streak."),
                new("Keep your {n}-day streak", "Today's drill is ready. Sing it before midnight and the streak carries on."),
            ],
            [PracticeReminderKind.FreezeReady] =
            [
                new("Your freeze is ready, but…", "It will cover today if you skip. Practise instead and your {n}-day streak becomes {next}."),
                new("Keep your freeze for later", "A two-minute drill today takes your streak to {next} days and saves the freeze."),
            ],
            [PracticeReminderKind.LastChance] =
            [
                new("Last chance for your {n}-day streak", "It ends at midnight. One short drill now keeps it going."),
                new("Your {n}-day streak ends tonight", "There's still time. Today's drill takes about two minutes."),
            ],
            [PracticeReminderKind.StreakLost] =
            [
                new("Your streak slipped", "Start a new one today? Your XP and badges are all still yours."),
                new("Start a new streak today", "Your {n}-day streak ended. Day 1 of the next one is a single two-minute drill."),
            ],
            [PracticeReminderKind.LearningWaiting] =
            [
                new("Your next drill is waiting", "A short solfa pattern to hear and sing back. It takes about two minutes."),
                new("Learning is waiting", "Two minutes of practice today keeps your ear in shape."),
                new("Ready to practise?", "Today's drill is ready whenever you are."),
            ],
            [PracticeReminderKind.Final] =
            [
                new("We'll stop the reminders", "We'll stop reminding you; Practice is here when you want it."),
                new("Last practice reminder", "We'll stop reminding you; Practice is here when you want it. Your XP and badges are kept."),
            ],
        };

    /// <summary>The variants for a situation in the track's voice: Focused plain, everyone else Doh's.</summary>
    public static IReadOnlyList<ReminderText> VariantsFor(PracticeReminderKind kind, PracticeTrack? track)
        => (track == PracticeTrack.Focused ? Plain : Playful)[kind];

    /// <summary>
    /// The words for <paramref name="kind"/> with <paramref name="streak"/> filled in. <paramref name="rotation"/>
    /// picks the variant (the day number plus a per-account offset, so consecutive days differ and accounts differ).
    /// </summary>
    public static ReminderText For(PracticeReminderKind kind, PracticeTrack? track, int streak, int rotation)
    {
        var variants = VariantsFor(kind, track);
        var pick = variants[((rotation % variants.Count) + variants.Count) % variants.Count];
        return new ReminderText(Fill(pick.Title, streak), Fill(pick.Body, streak));
    }

    /// <summary>A rotation for the account on the day: the day number, offset by the account so a cohort does not all read the same line.</summary>
    public static int Rotation(Guid userId, DateOnly localDate, PracticeReminderSlot slot)
        => localDate.DayNumber + userId.ToByteArray()[0] + (int)slot;

    private static string Fill(string template, int streak)
        => template
            .Replace("{next}", (streak + 1).ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{n}", streak.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
}
