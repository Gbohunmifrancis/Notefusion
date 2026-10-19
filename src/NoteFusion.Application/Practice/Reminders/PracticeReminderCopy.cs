using System.Globalization;
using NoteFusion.Core.Entities;
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
/// <para>
/// While the Christmas season is on for everyone, a few festive lines join the rotation (<see cref="ChristmasPlayful"/>,
/// <see cref="ChristmasPlain"/>), claiming no more than the lines they sit beside; <c>{carol}</c> is the singer's next
/// carol on the carols path, at most 31 characters (the tests check every line with it too).
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

    /// <summary>
    /// Doh's Christmas lines, joining <see cref="Playful"/>'s rotation while the season is on for everyone. <c>{carol}</c>
    /// is the carol of the singer's next drill on the carols path. A lapse, a freeze and the goodbye keep their usual
    /// words: they should not be festive.
    /// </summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> ChristmasPlayful =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Doh's warming up for carols 🎄", "A carol drill is ready! Two minutes of singing makes it {next} days in a row."),
            ],
            [PracticeReminderKind.LearningWaiting] =
            [
                new("{carol} is waiting 🎵", "Doh has your next carol drill ready. Two minutes of singing, then back to the celebrations!"),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("Keep the carols going: {n} days 🔥", "Your {n}-day streak ends at midnight. One short carol drill keeps it glowing."),
            ],
            [PracticeReminderKind.LastChance] =
            [
                new("⏰ One carol before midnight?", "Your {n}-day streak ends tonight. Doh saved you a two-minute carol drill to keep it safe."),
            ],
        };

    /// <summary>The Focused track's Christmas lines, plainly, joining <see cref="Plain"/>'s rotation while the season is on.</summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> ChristmasPlain =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Today's carol drill is ready", "{carol}: about two minutes. Practise today to make it {next} days in a row."),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("Keep your {n}-day streak this Christmas", "One short carol drill before midnight keeps it going."),
            ],
        };

    /// <summary>
    /// Doh's Halloween lines, joining <see cref="Playful"/>'s rotation while the Halloween season is on for everyone, as
    /// the Christmas ones do. <c>{song}</c> is the song of the singer's next drill on the Midnight path. Bats, lanterns and
    /// a ghost who sings: never gory. A lapse, a freeze and the goodbye keep their usual words.
    /// </summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> HalloweenPlayful =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Doh's hat is on: a spooky drill awaits 🎃", "A Halloween drill is ready! Two minutes of singing makes it {next} days in a row."),
            ],
            [PracticeReminderKind.LearningWaiting] =
            [
                new("{song} is waiting 🦇", "Doh has your next Midnight drill ready. Sing three notes before the bats wake up!"),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("Keep the lantern lit: {n} days 🔥", "Your {n}-day streak ends at midnight. One short Halloween drill keeps it glowing."),
            ],
            [PracticeReminderKind.LastChance] =
            [
                new("⏰ One spooky song before midnight?", "Your {n}-day streak ends tonight. Doh saved you a two-minute drill. No tricks!"),
            ],
        };

    /// <summary>The Focused track's Halloween lines, plainly, joining <see cref="Plain"/>'s rotation while the season is on.</summary>
    public static readonly IReadOnlyDictionary<PracticeReminderKind, IReadOnlyList<ReminderText>> HalloweenPlain =
        new Dictionary<PracticeReminderKind, IReadOnlyList<ReminderText>>
        {
            [PracticeReminderKind.Ordinary] =
            [
                new("Today's Halloween drill is ready", "{song}: about two minutes. Practise today to make it {next} days in a row."),
            ],
            [PracticeReminderKind.StreakAtRisk] =
            [
                new("Keep your {n}-day streak this Halloween", "One short drill before midnight keeps it going."),
            ],
        };

    /// <summary>
    /// The Midnight path's last day (1 November unless an admin picked another): an ordinary or "learning waiting"
    /// reminder to someone who has started the path and not finished it says so, on either track. <c>{left}</c> is "3 drills".
    /// </summary>
    public static readonly ReminderText HalloweenLastNight =
        new("Last night of the Midnight path 🕯️", "It closes at midnight. {left} left for the Night Singer sticker.");

    /// <summary>The variants for a situation in the track's voice: Focused plain, everyone else Doh's.</summary>
    public static IReadOnlyList<ReminderText> VariantsFor(PracticeReminderKind kind, PracticeTrack? track)
        => (track == PracticeTrack.Focused ? Plain : Playful)[kind];

    /// <summary>
    /// The variants for a situation in the track's voice, with the season's lines joining them while
    /// <paramref name="season"/> ("christmas", "halloween") is on. A line naming the next song (<c>{carol}</c>,
    /// <c>{song}</c>) joins only when there is one to name (<paramref name="song"/>; none once all six are sung).
    /// </summary>
    public static IReadOnlyList<ReminderText> VariantsFor(PracticeReminderKind kind, PracticeTrack? track, string? season, string? song)
    {
        var usual = VariantsFor(kind, track);
        var lines = (season, track == PracticeTrack.Focused) switch
        {
            (FeatureFlag.Christmas, true) => ChristmasPlain,
            (FeatureFlag.Christmas, false) => ChristmasPlayful,
            (FeatureFlag.Halloween, true) => HalloweenPlain,
            (FeatureFlag.Halloween, false) => HalloweenPlayful,
            _ => null,
        };
        if (lines is null || !lines.TryGetValue(kind, out var festive))
            return usual;
        return [.. usual, .. festive.Where(v => song is not null || !NamesSong(v))];
    }

    /// <summary>
    /// The words for <paramref name="kind"/> with <paramref name="streak"/> filled in. <paramref name="rotation"/>
    /// picks the variant (the day number plus a per-account offset, so consecutive days differ and accounts differ).
    /// </summary>
    public static ReminderText For(PracticeReminderKind kind, PracticeTrack? track, int streak, int rotation)
        => For(kind, track, streak, rotation, season: null, song: null);

    /// <summary>
    /// The words as <see cref="For(PracticeReminderKind, PracticeTrack?, int, int)"/> picks them, from the rotation the
    /// season's lines have joined while <paramref name="season"/> is on (for everyone); <c>{carol}</c> and <c>{song}</c>
    /// are <paramref name="song"/>, the singer's next song on the season's path. On the Midnight path's last day,
    /// <paramref name="lastNightLeft"/> (its drills the singer has left, having started it) makes an ordinary or "learning
    /// waiting" reminder <see cref="HalloweenLastNight"/>.
    /// </summary>
    public static ReminderText For(
        PracticeReminderKind kind, PracticeTrack? track, int streak, int rotation, string? season, string? song, int? lastNightLeft = null)
    {
        if (season == FeatureFlag.Halloween && lastNightLeft is > 0
            && kind is PracticeReminderKind.Ordinary or PracticeReminderKind.LearningWaiting)
        {
            var left = lastNightLeft == 1 ? "1 drill" : $"{lastNightLeft} drills";
            return new ReminderText(HalloweenLastNight.Title, HalloweenLastNight.Body.Replace("{left}", left, StringComparison.Ordinal));
        }
        var variants = VariantsFor(kind, track, season, song);
        var pick = variants[((rotation % variants.Count) + variants.Count) % variants.Count];
        return new ReminderText(Fill(pick.Title, streak, song), Fill(pick.Body, streak, song));
    }

    /// <summary>A rotation for the account on the day: the day number, offset by the account so a cohort does not all read the same line.</summary>
    public static int Rotation(Guid userId, DateOnly localDate, PracticeReminderSlot slot)
        => localDate.DayNumber + userId.ToByteArray()[0] + (int)slot;

    private static bool NamesSong(ReminderText text)
        => $"{text.Title} {text.Body}" is var words
           && (words.Contains("{carol}", StringComparison.Ordinal) || words.Contains("{song}", StringComparison.Ordinal));

    private static string Fill(string template, int streak, string? song = null)
        => template
            .Replace("{next}", (streak + 1).ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{n}", streak.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("{carol}", song ?? string.Empty, StringComparison.Ordinal)
            .Replace("{song}", song ?? string.Empty, StringComparison.Ordinal);
}
