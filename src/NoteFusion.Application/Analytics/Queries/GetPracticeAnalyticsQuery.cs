using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// The console's Practice page for a window (default the last 30 days): who practises and how much, whether they come
/// back, streaks, where singers get to on the path and where they stall, the daily drill allowance, reminders and
/// badges. Read off the rows practice writes, never off anything a client reported.
/// </summary>
/// <param name="From">Inclusive local start date. Null means <paramref name="To"/> minus 30 days.</param>
/// <param name="To">Inclusive local end date. Null means now.</param>
public sealed record GetPracticeAnalyticsQuery(DateTime? From = null, DateTime? To = null)
    : IRequest<Result<PracticeAnalyticsDto>>;

/// <remarks>
/// <para>
/// <b>Days.</b> A take and a reminder carry the singer's own calendar day (the day their streak and their daily drill
/// allowance count), so the window selects takes and reminders by that day: a take at 23:30 in Lagos is that day, not
/// the next. Badges and the week-on-week return comparison have no such day and use the reporting day (WAT).
/// </para>
/// <para>
/// <b>What is read.</b> Streaks, cohorts and the path are cumulative, so the window's singers' whole practice history
/// is read (one narrow row per marked take; the daily drill allowance bounds it at twenty a singer-day), from their
/// first take to thirty days past the window (a cohort's D30). Everything else is the window's rows, or a count or
/// group taken in the database. Like the rest of the console's analytics, the folding is done in memory so it reads
/// the same on Npgsql and on the tests' SQLite.
/// </para>
/// </remarks>
public sealed class GetPracticeAnalyticsQueryHandler : IRequestHandler<GetPracticeAnalyticsQuery, Result<PracticeAnalyticsDto>>
{
    private const int DefaultWindowDays = 30;

    /// <summary>Rows on the longest-streaks list.</summary>
    public const int LongestStreakCount = 10;

    /// <summary>A reminder converts when a take is marked within this long after it was sent.</summary>
    public static readonly TimeSpan ReminderConversionWindow = TimeSpan.FromHours(2);

    /// <summary>A free singer who hit the daily limit converts when they buy within this many days of it.</summary>
    public const int PurchaseWindowDays = 7;

    /// <summary>A streak "broken" is one of at least this many days: the length the app tells the singer it slipped.</summary>
    public const int BrokenStreakMinLength = PracticeReminderRules.StreakLostMinStreak;

    /// <summary>The cohort return days: practised again exactly this many days after the first.</summary>
    private const int CohortHorizonDays = 30;

    /// <summary>
    /// How far before the window singers are read for streak breaks and freezes: a streak still alive on the window's
    /// first day was practised within the three days before it (two freezes, across a week boundary, at most).
    /// </summary>
    private const int StreakLookBackDays = 7;

    private static readonly PracticeTrack?[] Tracks = [null, PracticeTrack.Playful, PracticeTrack.Focused];

    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetPracticeAnalyticsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    private sealed record Take(
        Guid Id, Guid UserId, PracticeKind Kind, int Score, bool WholePart, string? DrillId, DateOnly LocalDate, DateTime CreatedAtUtc);

    private sealed record Signal(Guid UserId, DateTime AtUtc);

    /// <summary>What the window looks like, shared by every section.</summary>
    private sealed record Window(AnalyticsRange Range, DateOnly First, DateOnly Last, DateOnly Today, DateTime NowUtc)
    {
        public bool Contains(DateOnly day) => day >= First && day <= Last;

        public IEnumerable<DateOnly> Days()
        {
            for (var d = First; d <= Last; d = d.AddDays(1))
                yield return d;
        }
    }

    public async Task<Result<PracticeAnalyticsDto>> Handle(GetPracticeAnalyticsQuery request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var rangeResult = AnalyticsRange.Create(request.From, request.To, DefaultWindowDays, now);
        if (rangeResult.IsFailure)
            return rangeResult.Error;
        var range = rangeResult.Value;
        var first = AnalyticsRange.LocalDateOf(range.FromUtc);
        var lastDay = AnalyticsRange.LocalDateOf(range.ToUtc.AddTicks(-1));
        var w = new Window(range, first, lastDay < first ? first : lastDay, AnalyticsRange.LocalDateOf(now), now);

        var sessions = _db.RealPracticeSessions().AsNoTracking();

        // The singers read in full: everyone with a take in the window or the week before it (for a streak that ended
        // on the window's first day), every take they have up to thirty days past the window.
        var readFrom = w.First.AddDays(-StreakLookBackDays);
        var singers = sessions.Where(s => s.LocalDate >= readFrom && s.LocalDate <= w.Last).Select(s => s.UserId).Distinct();
        var horizon = w.Last.AddDays(CohortHorizonDays);
        var history = await sessions
            .Where(s => singers.Contains(s.UserId) && s.LocalDate <= horizon)
            .Select(s => new Take(s.Id, s.UserId, s.Kind, s.Score, s.WholePart, s.DrillId, s.LocalDate, s.CreatedAtUtc))
            .ToListAsync(ct);
        var byUser = history
            .GroupBy(t => t.UserId)
            .ToDictionary(g => g.Key, g => g.OrderBy(t => t.CreatedAtUtc).ThenBy(t => t.Id).ToList());
        var windowTakes = history.Where(t => w.Contains(t.LocalDate)).ToList();
        var practisers = windowTakes.Select(t => t.UserId).ToHashSet();

        var windowIds = sessions.Where(s => s.LocalDate >= w.First && s.LocalDate <= w.Last).Select(s => s.UserId).Distinct();
        var people = await _db.RealUsers().AsNoTracking()
            .Where(u => windowIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email, u.PracticeTrack })
            .ToDictionaryAsync(u => u.Id, ct);

        var headline = await BuildHeadline(w, sessions, windowTakes, byUser, practisers,
            people.Values.Select(p => (p.Id, p.PracticeTrack)).ToList(), ct);
        var daily = w.Days().ToDictionary(d => d, d => new DayTally());
        TallyTakes(windowTakes, daily);

        var streaks = BuildStreaks(w, byUser, practisers, daily,
            id => people.TryGetValue(id, out var p) ? (p.FullName, p.Email) : null);
        var retention = new PracticeRetentionDto(
            BuildCohorts(w, byUser, practisers), [], 0, 0, null, 0, 0, null);
        retention = await WithWeeklyReturns(retention, w, sessions, ct);
        var path = BuildPath(w, byUser, daily);
        var allowance = await BuildAllowance(w, windowTakes, ct);
        var reminders = await BuildReminders(w, sessions, ct);
        var badges = await BuildBadges(w, daily, ct);

        return new PracticeAnalyticsDto(
            range.FromUtc,
            range.ToUtc,
            (int)AnalyticsRange.ReportingOffset.TotalMinutes,
            w.First,
            w.Last,
            headline,
            [.. daily.OrderBy(kv => kv.Key).Select(kv => kv.Value.ToDto(kv.Key))],
            retention,
            streaks,
            path,
            allowance,
            reminders,
            badges);
    }

    // ── Headline ────────────────────────────────────────────────────────────

    private async Task<PracticeHeadlineDto> BuildHeadline(
        Window w,
        IQueryable<Core.Entities.PracticeSession> sessions,
        List<Take> windowTakes,
        Dictionary<Guid, List<Take>> byUser,
        HashSet<Guid> practisers,
        List<(Guid Id, PracticeTrack? Track)> tracks,
        CancellationToken ct)
    {
        var previous = w.Range.PreviousPeriod();
        var prevFirst = AnalyticsRange.LocalDateOf(previous.FromUtc);
        var prevLast = w.First.AddDays(-1);
        var practisersPrevious = await sessions
            .Where(s => s.LocalDate >= prevFirst && s.LocalDate <= prevLast)
            .Select(s => s.UserId).Distinct().CountAsync(ct);
        var takesPrevious = await sessions.CountAsync(s => s.LocalDate >= prevFirst && s.LocalDate <= prevLast, ct);

        // Weekly and monthly actives look back from the window's last day, which may reach before the window.
        var weekFrom = w.Last.AddDays(-6);
        var monthFrom = w.Last.AddDays(-29);
        var wau = await sessions.Where(s => s.LocalDate >= weekFrom && s.LocalDate <= w.Last)
            .Select(s => s.UserId).Distinct().CountAsync(ct);
        var mau = await sessions.Where(s => s.LocalDate >= monthFrom && s.LocalDate <= w.Last)
            .Select(s => s.UserId).Distinct().CountAsync(ct);

        var practiserDays = windowTakes.Select(t => (t.UserId, t.LocalDate)).Distinct().Count();
        var dayCount = w.Days().Count();
        // byUser holds every take each singer has, so the earliest is their first ever.
        var newPractisers = practisers.Count(id => w.Contains(byUser[id].Min(t => t.LocalDate)));

        var byTrack = tracks.Where(t => practisers.Contains(t.Id)).ToList();
        IReadOnlyList<CategoryCountDto> trackCounts =
        [
            new("Playful", byTrack.Count(t => t.Track == PracticeTrack.Playful)),
            new("Focused", byTrack.Count(t => t.Track == PracticeTrack.Focused)),
            new("Not chosen", byTrack.Count(t => t.Track is null)),
        ];

        return new PracticeHeadlineDto(
            Practisers: practisers.Count,
            PractisersPrevious: practisersPrevious,
            NewPractisers: newPractisers,
            Dau: windowTakes.Where(t => t.LocalDate == w.Last).Select(t => t.UserId).Distinct().Count(),
            Wau: wau,
            Mau: mau,
            AverageDau: dayCount == 0 ? 0 : Math.Round(practiserDays / (double)dayCount, 2),
            Takes: windowTakes.Count,
            TakesPrevious: takesPrevious,
            Drills: windowTakes.Count(t => t.Kind == PracticeKind.Drill),
            Parts: windowTakes.Count(t => t.Kind == PracticeKind.Part),
            PractiserDays: practiserDays,
            TakesPerPractiserDay: practiserDays == 0 ? null : Math.Round(windowTakes.Count / (double)practiserDays, 2),
            AverageScore: windowTakes.Count == 0 ? null : Math.Round(windowTakes.Average(t => t.Score), 1),
            XpEarned: XpByUserDay(windowTakes).Values.Sum(),
            PractisersByTrack: trackCounts);
    }

    /// <summary>XP per singer-day, each day held to the cap: <see cref="PracticeMath.XpByDay"/> per singer.</summary>
    private static Dictionary<(Guid UserId, DateOnly Day), int> XpByUserDay(IEnumerable<Take> takes)
        => takes.GroupBy(t => t.UserId)
            .SelectMany(g => PracticeMath.XpByDay(g.Select(Fact)).Select(kv => (Key: (g.Key, kv.Key), kv.Value)))
            .ToDictionary(x => x.Key, x => x.Value);

    private static PracticeFact Fact(Take t) => new(t.Kind, t.Score, t.WholePart, t.LocalDate, t.CreatedAtUtc);

    private sealed class DayTally
    {
        public int Practisers, Drills, Parts, Xp, Units, Grades, Badges, Broken, Frozen;

        public PracticeDailyDto ToDto(DateOnly day)
            => new(day, Practisers, Drills, Parts, Xp, Units, Grades, Badges, Broken, Frozen);
    }

    private static void TallyTakes(List<Take> windowTakes, Dictionary<DateOnly, DayTally> daily)
    {
        foreach (var g in windowTakes.GroupBy(t => t.LocalDate))
        {
            var day = daily[g.Key];
            day.Practisers = g.Select(t => t.UserId).Distinct().Count();
            day.Drills = g.Count(t => t.Kind == PracticeKind.Drill);
            day.Parts = g.Count(t => t.Kind == PracticeKind.Part);
        }
        foreach (var ((_, day), xp) in XpByUserDay(windowTakes))
            daily[day].Xp += xp;
    }

    // ── Streaks ─────────────────────────────────────────────────────────────

    private static readonly (string Label, int Min, int Max)[] StreakBuckets =
    [
        ("0", 0, 0), ("1", 1, 1), ("2–3", 2, 3), ("4–7", 4, 7), ("8–29", 8, 29), ("30+", 30, int.MaxValue)
    ];

    private static PracticeStreaksDto BuildStreaks(
        Window w,
        Dictionary<Guid, List<Take>> byUser,
        HashSet<Guid> practisers,
        Dictionary<DateOnly, DayTally> daily,
        Func<Guid, (string Name, string Email)?> person)
    {
        // Read at the end of the window's last day: once that day is over it counts as missed (or frozen) like any
        // other; while it is today it is still open, as it is in the app.
        var asOf = w.Last < w.Today ? w.Last.AddDays(1) : w.Last;
        var current = new List<(Guid Id, int Current, int Best, DateOnly Last)>();
        int frozenTotal = 0, brokenTotal = 0;

        foreach (var (id, takes) in byUser)
        {
            var days = takes.Where(t => t.LocalDate <= w.Last).Select(t => t.LocalDate).ToHashSet();
            if (days.Count == 0)
                continue;
            var state = PracticeMath.Streak(days, asOf);
            foreach (var d in state.Frozen.Where(w.Contains))
            {
                daily[d].Frozen++;
                frozenTotal++;
            }
            foreach (var b in PracticeMath.StreakBreaks(days, asOf).Where(b => b.Length >= BrokenStreakMinLength && w.Contains(b.Day)))
            {
                daily[b.Day].Broken++;
                brokenTotal++;
            }
            if (practisers.Contains(id))
                current.Add((id, state.Current, state.Best, days.Max()));
        }

        var buckets = StreakBuckets
            .Select(b => new CategoryCountDto(b.Label, current.Count(c => c.Current >= b.Min && c.Current <= b.Max)))
            .ToList();
        var longest = current
            .Where(c => c.Current > 0)
            .OrderByDescending(c => c.Current).ThenByDescending(c => c.Best).ThenByDescending(c => c.Last).ThenBy(c => c.Id)
            .Select(c => (c, who: person(c.Id)))
            .Where(x => x.who is not null)
            .Take(LongestStreakCount)
            .Select(x => new StreakLeaderDto(x.c.Id, x.who!.Value.Name, x.who.Value.Email, x.c.Current, x.c.Best, x.c.Last))
            .ToList();

        return new PracticeStreaksDto(w.Last, buckets, frozenTotal, brokenTotal, longest);
    }

    // ── Retention ───────────────────────────────────────────────────────────

    /// <summary>
    /// Weekly cohorts of new singers (first take ever in the window), and the share who practised again exactly 1, 7
    /// and 30 days after their first day. A singer counts towards a day only once that day is over.
    /// </summary>
    private static IReadOnlyList<PracticeCohortDto> BuildCohorts(Window w, Dictionary<Guid, List<Take>> byUser, HashSet<Guid> practisers)
    {
        var firsts = practisers
            .Select(id => (Id: id, First: byUser[id].Min(t => t.LocalDate), Days: byUser[id].Select(t => t.LocalDate).ToHashSet()))
            .Where(x => w.Contains(x.First))
            .ToList();

        return [.. firsts
            .GroupBy(x => PracticeTime.WeekStart(x.First))
            .OrderBy(g => g.Key)
            .Select(g =>
            {
                (int Eligible, double? Rate) Back(int n)
                {
                    var eligible = g.Where(x => x.First.AddDays(n) < w.Today).ToList();
                    var back = eligible.Count(x => x.Days.Contains(x.First.AddDays(n)));
                    return (eligible.Count, eligible.Count == 0 ? null : Math.Round(back / (double)eligible.Count, 4));
                }
                var d1 = Back(1);
                var d7 = Back(7);
                var d30 = Back(30);
                return new PracticeCohortDto(g.Key, g.Count(), d1.Rate, d7.Rate, d30.Rate, d1.Eligible, d7.Eligible, d30.Eligible);
            })];
    }

    /// <summary>
    /// Does practice keep people coming back? For each Monday–Sunday week (reporting days) starting in the window whose
    /// following week is over: the accounts active in it, split by whether they had a take marked that week, and how
    /// many of each were active again the next week. Active: started a transcription, saved a sheet, did something
    /// signed in on the web, had a take marked, or was last seen then (the same signals as Engagement, plus practice).
    /// </summary>
    private async Task<PracticeRetentionDto> WithWeeklyReturns(
        PracticeRetentionDto retention, Window w, IQueryable<Core.Entities.PracticeSession> sessions, CancellationToken ct)
    {
        var weeks = new List<DateOnly>();
        for (var week = PracticeTime.WeekStart(w.First); week <= w.Last; week = week.AddDays(7))
        {
            if (week.AddDays(14) <= w.Today)
                weeks.Add(week);
        }
        if (weeks.Count == 0)
            return retention;

        var fromUtc = StartUtc(weeks[0]);
        var toUtc = StartUtc(weeks[^1].AddDays(14));

        var signals = new List<Signal>();
        signals.AddRange(await _db.RealJobs().AsNoTracking()
            .Where(j => j.CreatedAtUtc >= fromUtc && j.CreatedAtUtc < toUtc)
            .Select(j => new Signal(j.UserId, j.CreatedAtUtc)).ToListAsync(ct));
        signals.AddRange(await _db.RealSheets().AsNoTracking()
            .Where(t => t.CreatedAtUtc >= fromUtc && t.CreatedAtUtc < toUtc)
            .Select(t => new Signal(t.UserId, t.CreatedAtUtc)).ToListAsync(ct));
        signals.AddRange(await _db.RealWebEvents().AsNoTracking()
            .Where(e => e.UserId != null && e.OccurredAtUtc >= fromUtc && e.OccurredAtUtc < toUtc)
            .Select(e => new Signal(e.UserId!.Value, e.OccurredAtUtc)).ToListAsync(ct));
        signals.AddRange(await _db.RealUsers().AsNoTracking()
            .Where(u => (u.LastSeenAtUtc ?? u.LastLoginAt) != null
                        && (u.LastSeenAtUtc ?? u.LastLoginAt) >= fromUtc && (u.LastSeenAtUtc ?? u.LastLoginAt) < toUtc)
            .Select(u => new Signal(u.Id, (u.LastSeenAtUtc ?? u.LastLoginAt)!.Value)).ToListAsync(ct));
        // Bounded by the singer's day first (indexed; a singer's day is at most a day off the reporting one), then
        // by the instant.
        var practiceFrom = weeks[0].AddDays(-1);
        var practiceTo = weeks[^1].AddDays(15);
        var practice = await sessions
            .Where(s => s.LocalDate >= practiceFrom && s.LocalDate <= practiceTo
                        && s.CreatedAtUtc >= fromUtc && s.CreatedAtUtc < toUtc)
            .Select(s => new Signal(s.UserId, s.CreatedAtUtc)).ToListAsync(ct);
        signals.AddRange(practice);

        static DateOnly WeekOf(DateTime at) => PracticeTime.WeekStart(AnalyticsRange.LocalDateOf(at));
        var activeIn = signals.GroupBy(s => WeekOf(s.AtUtc)).ToDictionary(g => g.Key, g => g.Select(s => s.UserId).ToHashSet());
        var practisedIn = practice.GroupBy(s => WeekOf(s.AtUtc)).ToDictionary(g => g.Key, g => g.Select(s => s.UserId).ToHashSet());

        var rows = weeks.Select(week =>
        {
            var active = activeIn.GetValueOrDefault(week) ?? [];
            var next = activeIn.GetValueOrDefault(week.AddDays(7)) ?? [];
            var practised = practisedIn.GetValueOrDefault(week) ?? [];
            var others = active.Where(id => !practised.Contains(id)).ToList();
            return new WeeklyReturnDto(week, practised.Count, practised.Count(next.Contains), others.Count, others.Count(next.Contains));
        }).ToList();

        int pw = rows.Sum(r => r.PractisersActive), pb = rows.Sum(r => r.PractisersBack);
        int ow = rows.Sum(r => r.OthersActive), ob = rows.Sum(r => r.OthersBack);
        return retention with
        {
            Weeks = rows,
            PractiserWeeks = pw,
            PractiserWeeksBack = pb,
            PractiserRate = pw == 0 ? null : Math.Round(pb / (double)pw, 4),
            OtherWeeks = ow,
            OtherWeeksBack = ob,
            OtherRate = ow == 0 ? null : Math.Round(ob / (double)ow, 4),
        };
    }

    /// <summary>The instant a reporting-local day begins, as UTC.</summary>
    private static DateTime StartUtc(DateOnly day)
        => day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) - AnalyticsRange.ReportingOffset;

    // ── The path ────────────────────────────────────────────────────────────

    /// <summary>
    /// Every singer's paths replayed off their marked drills up to the window's end (<see cref="PracticePath.Read"/>,
    /// the same reading the app does), with each take that moved a path observed. Milestones are counted once per
    /// unit and grade, as the app reports them, on the day of the take that reached them.
    /// </summary>
    private static IReadOnlyList<PathTrackStatDto> BuildPath(Window w, Dictionary<Guid, List<Take>> byUser, Dictionary<DateOnly, DayTally> daily)
    {
        var steps = new List<(Guid UserId, PathStep Step)>();
        foreach (var (id, all) in byUser)
        {
            var takes = all.Where(t => t.LocalDate <= w.Last).ToList();
            var drills = takes
                .Where(t => t.Kind == PracticeKind.Drill && t.DrillId != null)
                .Select(t => new PathTake(t.Id, t.DrillId, t.Score, t.CreatedAtUtc, t.LocalDate))
                .ToList();
            if (drills.Count == 0)
                continue;

            var facts = takes.Select(Fact).ToList();
            var reading = PracticePath.Read(
                id,
                drills,
                at => PracticeMath.LevelFor(PracticeMath.TotalXp(facts.Where(f => f.CreatedAtUtc < at))).Index,
                step => steps.Add((id, step)));

            var dayOf = drills.ToDictionary(t => t.SessionId, t => t.LocalDate);
            foreach (var m in reading.Milestones)
            {
                var day = dayOf[m.SessionId];
                if (!w.Contains(day))
                    continue;
                if (m.Kind == MilestoneKind.Grade)
                    daily[day].Grades++;
                else
                    daily[day].Units++;
            }
        }

        return [.. Tracks.Select(track => TrackStats(w, track, steps.Where(s => s.Step.Track == track).ToList()))];
    }

    private static PathTrackStatDto TrackStats(Window w, PracticeTrack? track, List<(Guid UserId, PathStep Step)> steps)
    {
        var inWindow = steps.Where(s => w.Contains(s.Step.Take.LocalDate)).ToList();
        var singers = inWindow.Select(s => s.UserId).ToHashSet();

        // Positions only move forward, so the units a singer's path visited are the run from where it started to
        // where the last take left it (that unit is offered to them, so it counts as reached).
        var reach = steps.Where(s => singers.Contains(s.UserId))
            .GroupBy(s => s.UserId)
            .ToDictionary(g => g.Key, g => (
                From: g.Min(s => s.Step.Before.Position),
                To: g.Max(s => s.Step.After.Position),
                Done: g.Where(s => s.Step.FinishedUnit).Select(s => s.Step.Before.Position).ToHashSet()));

        static double? Rate(int n, int of) => of == 0 ? null : Math.Round(n / (double)of, 4);
        static double? Mean(IReadOnlyCollection<int> xs) => xs.Count == 0 ? null : Math.Round(xs.Average(), 1);

        var units = PracticePath.UnitsFor(track);
        var grades = units.GroupBy(u => u.Tier).OrderBy(g => g.Key).Select(g =>
        {
            var positions = g.Select(u => u.Position).ToHashSet();
            var lastUnit = g.Single(u => u.LastInGrade).Position;
            var gradeTakes = inWindow.Where(s => positions.Contains(s.Step.Unit.Position)).ToList();
            var unitStats = g.Select(u =>
                {
                    var at = inWindow.Where(s => s.Step.Unit.Position == u.Position).Select(s => s.Step).ToList();
                    return new PathUnitStatDto(
                        u.Code,
                        u.UnitNumber,
                        u.Unit.Title,
                        reach.Values.Count(r => r.From <= u.Position && u.Position <= r.To),
                        reach.Values.Count(r => r.Done.Contains(u.Position)),
                        at.Count,
                        Rate(at.Count(s => s.Passed), at.Count),
                        Rate(at.Count(s => s.Retry), at.Count),
                        Rate(at.Count(s => s.SteppedBack), at.Count),
                        Mean(at.Select(s => s.Take.Score).ToList()));
                })
                .Where(u => u.Reached > 0 || u.Takes > 0)
                .ToList();

            return new PathGradeStatDto(
                g.Key,
                DrillSyllabus.For(g.Key).Label,
                reach.Values.Count(r => positions.Any(p => r.From <= p && p <= r.To)),
                reach.Values.Count(r => r.Done.Contains(lastUnit)),
                gradeTakes.Count,
                Mean(gradeTakes.Select(s => s.Step.Take.Score).ToList()),
                unitStats);
        }).ToList();

        return new PathTrackStatDto(TrackName(track), singers.Count, inWindow.Count, grades);
    }

    private static string TrackName(PracticeTrack? track) => track switch
    {
        PracticeTrack.Playful => "playful",
        PracticeTrack.Focused => "focused",
        _ => "none"
    };

    // ── The daily drill allowance ───────────────────────────────────────────

    /// <summary>
    /// Singer-days that reached the day's drill limit: twenty drills (Pro's), or ten while not on Pro. Pro at the time is
    /// read from the account's membership (its first purchase to its current end, so a gap between two memberships reads
    /// as Pro) and any choir seat (joined, while the choir's plan ran). Then, of the free singers who hit the limit,
    /// how many bought something (Pro, a choir, or one song) within seven days after their first hit.
    /// </summary>
    private async Task<PracticeAllowanceDto> BuildAllowance(Window w, List<Take> windowTakes, CancellationToken ct)
    {
        int free = PracticeRules.FreeDrillGradesPerDay, pro = PracticeRules.ProDrillGradesPerDay;
        var days = windowTakes
            .Where(t => t.Kind == PracticeKind.Drill)
            .GroupBy(t => (t.UserId, t.LocalDate))
            .Select(g => (g.Key.UserId, Times: g.Select(t => t.CreatedAtUtc).OrderBy(x => x).ToList()))
            .ToList();
        var drillSingers = days.Select(d => d.UserId).Distinct().Count();

        var candidates = days.Where(d => d.Times.Count == free).Select(d => d.UserId).Distinct().ToList();
        var subs = await _db.Subscriptions.AsNoTracking()
            .Where(s => candidates.Contains(s.UserId))
            .Select(s => new { s.UserId, s.CreatedAtUtc, s.CurrentPeriodEndUtc })
            .ToListAsync(ct);
        var seats = await _db.ChoirMembers.AsNoTracking()
            .Where(m => candidates.Contains(m.UserId))
            .Join(_db.Choirs, m => m.ChoirId, c => c.Id, (m, c) => new { m.UserId, From = m.JoinedAtUtc, c.CreatedAtUtc, c.CurrentPeriodEndUtc })
            .ToListAsync(ct);
        var directed = await _db.Choirs.AsNoTracking()
            .Where(c => candidates.Contains(c.OwnerId))
            .Select(c => new { UserId = c.OwnerId, c.CreatedAtUtc, c.CurrentPeriodEndUtc })
            .ToListAsync(ct);
        bool WasPro(Guid id, DateTime at)
            => subs.Any(s => s.UserId == id && s.CreatedAtUtc <= at && at < s.CurrentPeriodEndUtc)
               || seats.Any(s => s.UserId == id && s.From <= at && s.CreatedAtUtc <= at && at < s.CurrentPeriodEndUtc)
               || directed.Any(c => c.UserId == id && c.CreatedAtUtc <= at && at < c.CurrentPeriodEndUtc);

        var hits = new List<(Guid UserId, DateTime At, bool Free)>();
        foreach (var (userId, times) in days)
        {
            if (times.Count >= pro)
                hits.Add((userId, times[pro - 1], false));
            // Free accounts are held to ten, so eleven to nineteen is Pro under its limit; exactly ten is the free
            // limit unless the singer was on Pro then.
            else if (times.Count == free && !WasPro(userId, times[free - 1]))
                hits.Add((userId, times[free - 1], true));
        }

        var firstFreeHit = hits.Where(h => h.Free).GroupBy(h => h.UserId).ToDictionary(g => g.Key, g => g.Min(h => h.At));
        var hitters = firstFreeHit.Keys.ToList();
        var earliest = hitters.Count == 0 ? DateTime.MaxValue : firstFreeHit.Values.Min();
        var purchases = hitters.Count == 0
            ? []
            : await _db.PaymentTransactions.AsNoTracking()
                .Where(p => hitters.Contains(p.UserId) && p.Status == PaymentStatus.Completed && p.UpdatedAtUtc >= earliest)
                .Join(_db.Plans, p => p.PlanId, plan => plan.Id, (p, plan) => new { p.UserId, PaidAt = p.UpdatedAtUtc, plan.Interval })
                .ToListAsync(ct);

        int bought = 0, membership = 0, single = 0, decided = 0;
        foreach (var (id, hitAt) in firstFreeHit)
        {
            var until = hitAt.AddDays(PurchaseWindowDays);
            var paid = purchases.Where(p => p.UserId == id && p.PaidAt >= hitAt && p.PaidAt <= until).ToList();
            if (paid.Count > 0)
            {
                bought++;
                if (paid.Any(p => p.Interval != BillingInterval.Single))
                    membership++;
                else
                    single++;
            }
            if (paid.Count > 0 || until <= w.NowUtc)
                decided++;
        }

        return new PracticeAllowanceDto(
            free,
            pro,
            drillSingers,
            HitLimit: hits.Select(h => h.UserId).Distinct().Count(),
            HitFreeLimit: hitters.Count,
            HitProLimit: hits.Where(h => !h.Free).Select(h => h.UserId).Distinct().Count(),
            LimitDays: hits.Count,
            FreeHitters: hitters.Count,
            FreeHittersDecided: decided,
            Bought: bought,
            BoughtMembership: membership,
            BoughtSingle: single,
            ConversionRate: decided == 0 ? null : Math.Round(bought / (double)decided, 4));
    }

    // ── Reminders ───────────────────────────────────────────────────────────

    private async Task<PracticeRemindersAnalyticsDto> BuildReminders(
        Window w, IQueryable<Core.Entities.PracticeSession> sessions, CancellationToken ct)
    {
        var inWindow = _db.RealPracticeReminders().AsNoTracking().Where(r => r.LocalDate >= w.First && r.LocalDate <= w.Last);
        var rows = await inWindow
            .Select(r => new { r.UserId, r.LocalDate, r.Kind, r.Status, r.SentAtUtc })
            .ToListAsync(ct);
        var sent = rows.Where(r => r.Status == PracticeReminderStatus.Sent && r.SentAtUtc != null).ToList();

        // The takes that could follow a reminder: its singer's, from the window's first day to the day after its last
        // (two hours after a late reminder can be the next local day).
        var remindedIds = inWindow.Where(r => r.Status == PracticeReminderStatus.Sent).Select(r => r.UserId).Distinct();
        var dayAfter = w.Last.AddDays(1);
        var takes = (await sessions
                .Where(s => remindedIds.Contains(s.UserId) && s.LocalDate >= w.First && s.LocalDate <= dayAfter)
                .Select(s => new { s.UserId, s.LocalDate, s.CreatedAtUtc })
                .ToListAsync(ct))
            .ToLookup(s => s.UserId);

        var outcomes = sent.Select(r =>
        {
            var at = r.SentAtUtc!.Value;
            var after = takes[r.UserId].Where(s => s.CreatedAtUtc >= at).ToList();
            return new
            {
                r.Kind,
                Within = after.Any(s => s.CreatedAtUtc <= at + ReminderConversionWindow),
                SameDay = after.Any(s => s.LocalDate == r.LocalDate),
            };
        }).ToList();

        static double? Rate(int n, int of) => of == 0 ? null : Math.Round(n / (double)of, 4);
        var kinds = Enum.GetValues<PracticeReminderKind>().Select(k =>
        {
            var o = outcomes.Where(x => x.Kind == k).ToList();
            int within = o.Count(x => x.Within), sameDay = o.Count(x => x.SameDay);
            return new ReminderKindStatDto(
                k, o.Count, rows.Count(r => r.Kind == k && r.Status == PracticeReminderStatus.Failed),
                within, sameDay, Rate(within, o.Count), Rate(sameDay, o.Count));
        }).ToList();

        var daily = w.Days().Select(d =>
        {
            int Sent(PracticeReminderKind k) => sent.Count(r => r.LocalDate == d && r.Kind == k);
            return new ReminderDayDto(
                d,
                Sent(PracticeReminderKind.Ordinary),
                Sent(PracticeReminderKind.StreakAtRisk),
                Sent(PracticeReminderKind.FreezeReady),
                Sent(PracticeReminderKind.LastChance),
                Sent(PracticeReminderKind.StreakLost),
                Sent(PracticeReminderKind.LearningWaiting),
                Sent(PracticeReminderKind.Final),
                rows.Count(r => r.LocalDate == d && r.Status == PracticeReminderStatus.Failed));
        }).ToList();

        // The switch keeps no history, so these two are a snapshot of now.
        var users = _db.RealUsers().AsNoTracking();
        var off = await users.CountAsync(u => u.PracticeRemindersOn == false, ct);
        var applicable = await users.CountAsync(u => u.PracticeRemindersOn != null
                                                     || u.PracticeTrack != null
                                                     || _db.PracticeSessions.Any(s => s.UserId == u.Id), ct);

        // "We'll stop reminding you": did the singer practise after it?
        var finals = sent.Where(r => r.Kind == PracticeReminderKind.Final)
            .GroupBy(r => r.UserId).ToDictionary(g => g.Key, g => g.Min(r => r.SentAtUtc!.Value));
        var finalIds = finals.Keys.ToList();
        var lastTake = finalIds.Count == 0
            ? []
            : await sessions.Where(s => finalIds.Contains(s.UserId))
                .GroupBy(s => s.UserId)
                .Select(g => new { UserId = g.Key, Last = g.Max(s => s.CreatedAtUtc) })
                .ToListAsync(ct);
        var cameBack = lastTake.Count(t => t.Last > finals[t.UserId]);

        var phones = await _db.RealDeviceTokens().AsNoTracking()
            .Where(d => d.Platform != "web")
            .GroupBy(d => d.ServerReminders)
            .Select(g => new { ServerReminders = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return new PracticeRemindersAnalyticsDto(
            Sent: sent.Count,
            Failed: rows.Count(r => r.Status == PracticeReminderStatus.Failed),
            Pending: rows.Count(r => r.Status == PracticeReminderStatus.Pending),
            AccountsReminded: sent.Select(r => r.UserId).Distinct().Count(),
            PractisedWithin2h: outcomes.Count(o => o.Within),
            PractisedSameDay: outcomes.Count(o => o.SameDay),
            Kinds: kinds,
            Daily: daily,
            RemindersOff: off,
            RemindersApplicable: applicable,
            FinalSent: finals.Count,
            FinalCameBack: cameBack,
            Phones: phones.Sum(p => p.Count),
            PhonesOnServerReminders: phones.Where(p => p.ServerReminders).Sum(p => p.Count));
    }

    // ── Badges ──────────────────────────────────────────────────────────────

    private async Task<IReadOnlyList<PracticeBadgeStatDto>> BuildBadges(Window w, Dictionary<DateOnly, DayTally> daily, CancellationToken ct)
    {
        var achievements = _db.RealAchievements().AsNoTracking();
        var allTime = await achievements
            .GroupBy(a => a.Code)
            .Select(g => new { Code = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Code, x => x.Count, ct);
        var recent = await achievements
            .Where(a => a.AwardedAtUtc >= w.Range.FromUtc && a.AwardedAtUtc < w.Range.ToUtc)
            .Select(a => new { a.Code, a.AwardedAtUtc })
            .ToListAsync(ct);

        foreach (var a in recent)
        {
            if (daily.TryGetValue(AnalyticsRange.LocalDateOf(a.AwardedAtUtc), out var day))
                day.Badges++;
        }

        var known = PracticeBadges.All.Select(b => b.Code).ToHashSet(StringComparer.Ordinal);
        return
        [
            .. PracticeBadges.All.Select(b => new PracticeBadgeStatDto(
                b.Code, b.Title, recent.Count(a => a.Code == b.Code), allTime.GetValueOrDefault(b.Code))),
            // A code no longer in the list (badges are never renamed, but say so if one ever is).
            .. allTime.Keys.Where(c => !known.Contains(c)).Order(StringComparer.Ordinal).Select(c => new PracticeBadgeStatDto(
                c, c, recent.Count(a => a.Code == c), allTime[c])),
        ];
    }
}
