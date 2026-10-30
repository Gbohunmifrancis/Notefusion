using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>How the drill offered differs from the one the path would otherwise give: after a skip ahead, a step back or an easier variant.</summary>
public enum DrillAdjustment
{
    Steady = 0,
    Harder = 1,
    Easier = 2
}

/// <summary>A milestone reached: a unit of a grade finished, or a whole grade.</summary>
public enum MilestoneKind
{
    Unit = 0,
    Grade = 1
}

/// <summary>
/// One unit on a track's path: a grade's <paramref name="Step"/>th unit, numbered among the units of that grade the
/// track sings (<paramref name="UnitNumber"/> of <paramref name="UnitsInGrade"/>), with <paramref name="DrillCount"/>
/// drills to pass. <paramref name="Track"/> names a Mastery unit's own (Playful's are its own three).
/// </summary>
public sealed record PathUnit(int Position, int Tier, int Step, int UnitNumber, int UnitsInGrade, int DrillCount, bool LastInGrade, PracticeTrack? Track = null)
{
    /// <summary>The unit's identity, shared by every track that sings it: milestones fire once per code.</summary>
    public string Code => $"g{Tier}u{Step}";

    public DrillSyllabus Grade => DrillSyllabus.For(Tier);

    public DrillUnit Unit => MasteryCatalogue.IsMastery(Tier) ? MasteryCatalogue.UnitOf(Track, Step) : Grade.Units[Step - 1];
}

/// <summary>A marked drill, as the path reads it: which drill, its mark, and when.</summary>
public sealed record PathTake(Guid SessionId, string? DrillId, int Score, DateTime CreatedAtUtc, DateOnly LocalDate);

/// <summary>
/// Where a singer is on a track's path: the unit (<paramref name="Position"/>), the drill in it (<paramref name="Slot"/>,
/// from 0), takes missed at that drill (<paramref name="Misses"/>), laps of review past the path's end, the day's runs
/// of very good and very poor takes, and how the last take moved them.
/// </summary>
public sealed record PathPlace(int Position, int Slot, int Misses, int Lap, int HotRun, int ColdRun, DrillAdjustment Move, DateOnly? LastDate);

/// <summary>A milestone reached by one marked take.</summary>
public sealed record PathMilestone(Guid SessionId, MilestoneKind Kind, PathUnit Unit, PracticeTrack? Track);

/// <summary>
/// One marked take that moved a track's path: the unit it was sung in, and the place before and after it. What
/// <see cref="PracticePath.Read"/> hands an observer, for the admin console's path analytics; the outcomes below are
/// read off <see cref="PracticePath.Advance"/>'s result, so they cannot disagree with the path.
/// </summary>
public sealed record PathStep(PathTake Take, PracticeTrack? Track, PathUnit Unit, PathPlace Before, PathPlace After)
{
    /// <summary>Marked <see cref="PracticeRules.PassScore"/> or more: the drill passed.</summary>
    public bool Passed => Take.Score >= PracticeRules.PassScore;

    /// <summary>Sung at a drill already missed: the same drill once more, or an easier variant of it.</summary>
    public bool Retry => Before.Misses > 0;

    /// <summary>
    /// The second take under <see cref="PracticeRules.StepBackScore"/> in a row that day, which stepped back: the
    /// run of poor takes is the only thing <see cref="PracticePath.Advance"/> resets to zero after such a take.
    /// </summary>
    public bool SteppedBack => Take.Score < PracticeRules.StepBackScore && After.ColdRun == 0;

    /// <summary>The second very good take in a row that day, which skipped the unit's next drill.</summary>
    public bool SkippedAhead => After.Move == DrillAdjustment.Harder;

    /// <summary>The take finished its unit: the path moved to the next unit, or past the end into review.</summary>
    public bool FinishedUnit => After.Position != Before.Position || After.Lap != Before.Lap;
}

/// <summary>The drill a track's path offers next, and where on the path it is.</summary>
public sealed record PathStop(PracticeTrack? Track, PathUnit Unit, PathPlace Place, Drill Drill)
{
    /// <summary>Past the end of the path: the last unit, sung again.</summary>
    public bool Review => Place.Lap > 0;

    public DrillAdjustment Adjustment => Place.Move;
}

/// <summary>An account's path on each track, and the milestones its takes reached, as read off its marked drills.</summary>
public sealed class PathReading
{
    private readonly PathPlace?[] _places;

    internal PathReading(PathPlace?[] places, IReadOnlyList<PathMilestone> milestones, int unitsComplete, int gradesComplete)
    {
        _places = places;
        Milestones = milestones;
        UnitsComplete = unitsComplete;
        GradesComplete = gradesComplete;
    }

    /// <summary>Every milestone, in the order reached, each with the take that reached it.</summary>
    public IReadOnlyList<PathMilestone> Milestones { get; }

    /// <summary>Units finished on any track (each counted once).</summary>
    public int UnitsComplete { get; }

    /// <summary>Grades finished on any track (each counted once).</summary>
    public int GradesComplete { get; }

    /// <summary>Where the track's path stands, or null when no take has been on it yet.</summary>
    public PathPlace? PlaceOn(PracticeTrack? track) => _places[PracticePath.TrackIndex(track)];

    /// <summary>The milestone a take reached, the grade's when it finished both: null for most takes.</summary>
    public PathMilestone? ReachedBy(Guid sessionId)
        => Milestones.Where(m => m.SessionId == sessionId).OrderByDescending(m => m.Kind).FirstOrDefault();
}

/// <summary>
/// Practice as a lesson path: grades → units → drills, sung in order, each marked take moving the singer on, keeping
/// them, or easing off. Pure: the account's marked drills go in, the next drill and the milestones come out, so a
/// refresh gives the same drill and every rule is unit-tested without a database.
/// </summary>
/// <remarks>
/// <para>
/// <b>The path.</b> A track's path is its grades in order (no track: Grades 1–8; Playful: Grades 1–7, the first three
/// units of each, the drills it may offer; Focused: Grades 1–8 and Advanced 1–2), each grade its units easiest first,
/// each unit <see cref="PracticeRules.DrillsPerUnit"/> drills (<see cref="PracticeRules.PlayfulDrillsPerUnit"/> on
/// Playful). A singer starts their track's path at the grade for the level they had reached
/// (<see cref="DrillCatalogue.TierFor"/>: a beginner on Focused starts on Grade 3's scales).
/// </para>
/// <para>
/// <b>Which drill.</b> A unit's patterns are put in an order by a hash of the user, the unit and the lap, and its drill
/// at a position is that order's pattern there, in a key of its grade picked by a hash of the user, the unit and the
/// position. The next drill is therefore the same until a take on it is marked — on any device, after any refresh.
/// </para>
/// <para>
/// <b>Moving on.</b> Only a take of the drill the path offered at the time moves it (a take sung again for practice, or
/// one from an old screen, earns XP but leaves the path where it is). A take marked <see cref="PracticeRules.PassScore"/>
/// or more passes the drill; under it the same drill comes back once, then an easier variant (the unit before's
/// patterns) until one is passed. Within one day's session, <see cref="PracticeRules.SkipAheadRun"/> takes of
/// <see cref="PracticeRules.SkipAheadScore"/>+ in a row skip the unit's next drill, and
/// <see cref="PracticeRules.StepBackRun"/> under <see cref="PracticeRules.StepBackScore"/> in a row step back to its
/// previous one. Passing a unit's last drill finishes the unit (a milestone) and, at a grade's last unit, the grade (a
/// bigger one); each unit and grade is a milestone once, whichever track finished it. Past the end of the path the last
/// unit is sung again, in new orders and keys, with no milestones.
/// </para>
/// <para>
/// Milestones are not stored: like XP, they are read off the marked drills every time, so the take that reached one
/// is the only take that ever reports it.
/// </para>
/// </remarks>
public static class PracticePath
{
    private static readonly PracticeTrack?[] Tracks = [null, PracticeTrack.Playful, PracticeTrack.Focused];
    private static readonly IReadOnlyList<PathUnit>[] UnitLists = Tracks.Select(BuildUnits).ToArray();

    internal static int TrackIndex(PracticeTrack? track) => track switch
    {
        PracticeTrack.Playful => 1,
        PracticeTrack.Focused => 2,
        _ => 0
    };

    /// <summary>A track's path, unit by unit, in order.</summary>
    public static IReadOnlyList<PathUnit> UnitsFor(PracticeTrack? track) => UnitLists[TrackIndex(track)];

    private static IReadOnlyList<PathUnit> BuildUnits(PracticeTrack? track)
    {
        // A track's path goes on past the catalogue into Mastery 1, 2, 3… (none chosen: the ladder alone).
        var topTier = track switch
        {
            PracticeTrack.Playful or PracticeTrack.Focused => MasteryCatalogue.FirstTier + MasteryCatalogue.Tiers - 1,
            _ => DrillCatalogue.LadderTopTier
        };
        var topStep = track == PracticeTrack.Playful ? PracticeRules.PlayfulTopStep : DrillSyllabus.UnitsPerGrade;
        var drills = track == PracticeTrack.Playful ? PracticeRules.PlayfulDrillsPerUnit : PracticeRules.DrillsPerUnit;

        var units = new List<PathUnit>();
        for (var tier = 0; tier <= topTier; tier++)
        {
            var steps = Enumerable.Range(1, topStep).Where(step => DrillCatalogue.UnitPatterns(track, tier, step).Count > 0).ToList();
            for (var i = 0; i < steps.Count; i++)
                units.Add(new PathUnit(units.Count, tier, steps[i], i + 1, steps.Count, drills, i == steps.Count - 1, track));
        }
        return units;
    }

    /// <summary>Where a singer at <paramref name="levelIndex"/> starts a track's path: the first unit of their grade.</summary>
    public static PathPlace Entry(PracticeTrack? track, int levelIndex)
    {
        var units = UnitsFor(track);
        var tier = DrillCatalogue.TierFor(track, levelIndex);
        var first = units.FirstOrDefault(u => u.Tier >= tier) ?? units[^1];
        return new PathPlace(first.Position, 0, 0, 0, 0, 0, DrillAdjustment.Steady, null);
    }

    /// <summary>
    /// Reads every track's path off an account's marked drills, oldest first. <paramref name="levelBefore"/> gives the
    /// level the account had reached before a moment: a track's path starts at the grade for the level held when its
    /// first take was sung. <paramref name="observe"/>, when given, is handed every take that moved a track's path, in
    /// order (the admin console's path analytics); it changes nothing about the reading.
    /// </summary>
    public static PathReading Read(
        Guid userId, IEnumerable<PathTake> takes, Func<DateTime, int> levelBefore, Action<PathStep>? observe = null)
    {
        var places = new PathPlace?[Tracks.Length];
        var milestones = new List<PathMilestone>();
        var unitsDone = new HashSet<string>(StringComparer.Ordinal);
        var gradesDone = new HashSet<int>();
        var offered = new Dictionary<(int, PathPlace), string>();

        foreach (var take in takes.OrderBy(t => t.CreatedAtUtc).ThenBy(t => t.SessionId))
        {
            if (take.DrillId is null)
                continue;
            int? level = null;
            for (var t = 0; t < Tracks.Length; t++)
            {
                var track = Tracks[t];
                var place = places[t] ?? Entry(track, level ??= levelBefore(take.CreatedAtUtc));
                var key = (t, place with { HotRun = 0, ColdRun = 0, Move = DrillAdjustment.Steady, LastDate = null });
                if (!offered.TryGetValue(key, out var id))
                    offered[key] = id = OfferedId(userId, track, place);
                if (!SameDrill(take.DrillId, id))
                    continue;

                var units = UnitsFor(track);
                var finished = new List<int>();
                places[t] = Advance(place, take.Score, take.LocalDate, units, finished);
                observe?.Invoke(new PathStep(take, track, units[place.Position], place, places[t]!));
                foreach (var position in finished)
                {
                    var unit = units[position];
                    if (unitsDone.Add(unit.Code))
                        milestones.Add(new PathMilestone(take.SessionId, MilestoneKind.Unit, unit, track));
                    if (unit.LastInGrade && gradesDone.Add(unit.Tier))
                        milestones.Add(new PathMilestone(take.SessionId, MilestoneKind.Grade, unit, track));
                }
            }
        }

        return new PathReading(places, milestones, unitsDone.Count, gradesDone.Count);
    }

    /// <summary>The drill a track's path offers next (its entry, at <paramref name="levelNow"/>, before any take on it).</summary>
    /// <remarks>
    /// With a <paramref name="fit"/> (the singer's range, their switch on), the drill is placed in a key that sits in it
    /// (<see cref="VoiceFit"/>). The key never moves the path: a take counts for the drill offered in whatever key it was
    /// sung (<see cref="SameDrill"/>).
    /// </remarks>
    public static PathStop Next(Guid userId, PracticeTrack? track, PathReading reading, int levelNow, VoiceFit? fit = null)
    {
        var place = reading.PlaceOn(track) ?? Entry(track, levelNow);
        var (pattern, doh) = Offer(userId, track, place, fit);
        var unit = UnitsFor(track)[place.Position];
        return new PathStop(track, unit, place, DrillCatalogue.Build(pattern, doh, gentle: track == PracticeTrack.Playful));
    }

    /// <summary>
    /// One marked take of the offered drill applied: passed (on, or two on after a run of very good takes), missed
    /// (the same again, then easier variants), or, after a run of very poor takes, a step back. Units finished are added
    /// to <paramref name="finished"/> by position.
    /// </summary>
    public static PathPlace Advance(PathPlace place, int score, DateOnly date, IReadOnlyList<PathUnit> units, ICollection<int> finished)
    {
        // The runs are a session's: they start again each day.
        var sameDay = place.LastDate == date;
        var hot = sameDay ? place.HotRun : 0;
        var cold = sameDay ? place.ColdRun : 0;

        PathPlace next;
        if (score >= PracticeRules.PassScore)
        {
            hot = score >= PracticeRules.SkipAheadScore ? hot + 1 : 0;
            cold = 0;
            next = NextDrill(place with { Misses = 0, Move = DrillAdjustment.Steady }, units, finished);
            if (hot >= PracticeRules.SkipAheadRun)
            {
                hot = 0;
                // A skip stays inside the unit: a new unit's first drill is never skipped.
                if (next.Position == place.Position && next.Lap == place.Lap)
                    next = NextDrill(next, units, finished) with { Move = DrillAdjustment.Harder };
            }
        }
        else
        {
            hot = 0;
            cold = score < PracticeRules.StepBackScore ? cold + 1 : 0;
            if (cold >= PracticeRules.StepBackRun)
            {
                cold = 0;
                next = place.Slot > 0
                    ? place with { Slot = place.Slot - 1, Misses = 0, Move = DrillAdjustment.Easier }
                    : place with { Misses = Math.Max(place.Misses + 1, PracticeRules.RetriesBeforeEasier + 1), Move = DrillAdjustment.Easier };
            }
            else
            {
                var misses = place.Misses + 1;
                next = place with
                {
                    Misses = misses,
                    Move = misses > PracticeRules.RetriesBeforeEasier ? DrillAdjustment.Easier : DrillAdjustment.Steady
                };
            }
        }

        return next with { HotRun = hot, ColdRun = cold, LastDate = date };
    }

    /// <summary>The unit's next drill; after its last, the next unit's first (or, at the path's end, another lap of review).</summary>
    private static PathPlace NextDrill(PathPlace place, IReadOnlyList<PathUnit> units, ICollection<int> finished)
    {
        var unit = units[place.Position];
        if (place.Slot + 1 < unit.DrillCount)
            return place with { Slot = place.Slot + 1 };
        finished.Add(place.Position);
        return place.Position + 1 < units.Count
            ? place with { Position = place.Position + 1, Slot = 0, Lap = 0 }
            : place with { Slot = 0, Lap = place.Lap + 1 };
    }

    /// <summary>
    /// Whether a take was of the drill a place offers: the same pattern at the same pace (the <c>~gentle</c> suffix),
    /// whatever key it was placed in, so a singer whose keys follow their range (or who sang a key offered before the
    /// switch) moves along the path all the same.
    /// </summary>
    public static bool SameDrill(string? taken, string offered)
        => taken is not null && string.Equals(WithoutKey(taken), WithoutKey(offered), StringComparison.Ordinal);

    /// <summary>"code@60~gentle" → "code~gentle": the drill without its key.</summary>
    private static string WithoutKey(string id)
    {
        var at = id.IndexOf('@');
        if (at < 0)
            return id;
        var tilde = id.IndexOf('~', at);
        return id[..at] + (tilde >= 0 ? id[tilde..] : string.Empty);
    }

    /// <summary>The id of the drill a place offers, without building it.</summary>
    public static string OfferedId(Guid userId, PracticeTrack? track, PathPlace place)
    {
        var (pattern, doh) = Offer(userId, track, place);
        return DrillCatalogue.IdOf(pattern, doh, gentle: track == PracticeTrack.Playful);
    }

    /// <summary>
    /// The pattern and doh a place offers: the unit's drill at its position, or, after
    /// <see cref="PracticeRules.RetriesBeforeEasier"/> misses there, an easier variant (another for each further miss).
    /// </summary>
    public static (DrillPattern Pattern, int Doh) Offer(Guid userId, PracticeTrack? track, PathPlace place, VoiceFit? fit = null)
    {
        var unit = UnitsFor(track)[place.Position];
        var stem = $"{unit.Code}:{place.Lap}:{place.Slot}";
        if (place.Misses <= PracticeRules.RetriesBeforeEasier)
            return Standard(userId, track, unit, place.Lap, place.Slot, fit);

        var variant = place.Misses - PracticeRules.RetriesBeforeEasier;
        var pool = Ordered(userId, EasierPool(track, unit), $"{stem}:easier");
        var pattern = pool[(variant - 1) % pool.Count];
        return (pattern, KeyFor(userId, pattern, $"{stem}:easier:{variant}", fit));
    }

    /// <summary>The unit's own drill at a position: its patterns in the user's order, and no drill twice in a row.</summary>
    private static (DrillPattern Pattern, int Doh) Standard(Guid userId, PracticeTrack? track, PathUnit unit, int lap, int slot, VoiceFit? fit)
    {
        var pool = Ordered(userId, DrillCatalogue.UnitPatterns(track, unit.Tier, unit.Step), $"{unit.Code}:{lap}");
        var pattern = pool[slot % pool.Count];
        var placements = Placements(pattern, fit);
        var pick = (int)(DrillCatalogue.Hash(userId, $"{unit.Code}:{lap}:{slot}:key") % (ulong)placements.Count);
        if (slot > 0 && placements.Count > 1 && pool[(slot - 1) % pool.Count] == pattern)
        {
            var before = (int)(DrillCatalogue.Hash(userId, $"{unit.Code}:{lap}:{slot - 1}:key") % (ulong)placements.Count);
            if (before == pick)
                pick = (pick + 1) % placements.Count;
        }
        return (pattern, placements[pick]);
    }

    /// <summary>
    /// What a singer who keeps missing a unit's drill is offered instead: the patterns of the unit before it on the
    /// track (the grade before's last, for a grade's first unit), or at the very start the unit's shortest.
    /// </summary>
    public static IReadOnlyList<DrillPattern> EasierPool(PracticeTrack? track, PathUnit unit)
    {
        var topStep = track == PracticeTrack.Playful ? PracticeRules.PlayfulTopStep : DrillSyllabus.UnitsPerGrade;
        for (var tier = unit.Tier; tier >= 0; tier--)
        {
            for (var step = tier == unit.Tier ? unit.Step - 1 : topStep; step >= 1; step--)
            {
                var pool = DrillCatalogue.UnitPatterns(track, tier, step);
                if (pool.Count > 0)
                    return pool;
            }
        }
        var own = DrillCatalogue.UnitPatterns(track, unit.Tier, unit.Step);
        var shortest = own.Min(p => p.Tokens.Count);
        return own.Where(p => p.Tokens.Count == shortest).ToList();
    }

    private static List<DrillPattern> Ordered(Guid userId, IReadOnlyList<DrillPattern> pool, string words)
        => pool.OrderBy(p => DrillCatalogue.Hash(userId, $"{words}:{p.Code}")).ThenBy(p => p.Code, StringComparer.Ordinal).ToList();

    private static int KeyFor(Guid userId, DrillPattern pattern, string words, VoiceFit? fit)
    {
        var placements = Placements(pattern, fit);
        return placements[(int)(DrillCatalogue.Hash(userId, $"{words}:key") % (ulong)placements.Count)];
    }

    /// <summary>A pattern's keys for its grade, those in the singer's range when there is a fit.</summary>
    private static IReadOnlyList<int> Placements(DrillPattern pattern, VoiceFit? fit)
    {
        var placements = DrillCatalogue.Placements(pattern);
        return fit is null ? placements : fit.Choose(placements, DrillCatalogue.Offsets(pattern));
    }
}
