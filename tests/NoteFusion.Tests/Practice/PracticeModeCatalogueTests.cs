using Microsoft.Extensions.Configuration;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Infrastructure.Practice;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The practice modes' content: every exercise in every key it may be placed in reads as written (the solfa engine's
/// labels), keeps the sung notes between A3 and D5, is timed so its grader is fair, and is found again from its id;
/// the warm-up, the range's words and the modes each track lists.
/// </summary>
public class PracticeModeCatalogueTests
{
    private static readonly Guid Singer = Guid.Parse("8d1f6a52-3f43-4b8e-9a51-0f1b2c3d4e5f");
    private static readonly DateOnly Today = new(2026, 10, 18);

    /// <summary>Every exercise the catalogue can hand out: each pitched one on each of its keys, each run at each speed.</summary>
    private static IEnumerable<PracticeExercise> Everything()
    {
        foreach (var s in ModeCatalogue.PitchMatchSets)
            foreach (var doh in ModeCatalogue.Placements(s))
                yield return ModeCatalogue.BuildPitchMatch(s, doh);
        foreach (var p in ModeCatalogue.Intervals)
            foreach (var doh in ModeCatalogue.Placements(p))
                yield return ModeCatalogue.BuildInterval(p, doh);
        foreach (var h in ModeCatalogue.HarmonyLines)
            foreach (var doh in ModeCatalogue.Placements(h))
                yield return ModeCatalogue.BuildHarmony(h, doh);
        foreach (var r in ModeCatalogue.Runs)
            foreach (var doh in ModeCatalogue.Placements(r))
                foreach (var pct in ModeCatalogue.RunSpeeds)
                    yield return ModeCatalogue.BuildRun(r, doh, pct);
        foreach (var r in ModeCatalogue.Rhythms)
            yield return ModeCatalogue.BuildRhythm(r);
    }

    [Fact]
    public void Every_exercise_is_found_again_from_its_id_and_its_id_fits_a_practice_row()
    {
        var all = Everything().ToList();
        Assert.True(all.Count > 300);
        Assert.Equal(all.Count, all.Select(e => e.Id).Distinct().Count());
        foreach (var e in all)
        {
            Assert.True(e.Id.Length <= PracticeSession.DrillIdMaxLength, e.Id);
            var found = ModeCatalogue.Find(e.Id);
            Assert.NotNull(found);
            Assert.Equal(e.Notes, found.Notes);
            Assert.Equal(e.Backing, found.Backing);
            Assert.Equal(e.Claps, found.Claps);
            Assert.Equal((e.TempoBpm, e.Grader, e.OffsetSearchSec), (found.TempoBpm, found.Grader, found.OffsetSearchSec));
            Assert.Equal(PracticeModes.KindOf(e.Mode), e.Kind);
            Assert.True(PracticeRules.UsesDrillAllowance(e.Kind));
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("steps-up@60")] // a drill's id, not a mode's
    [InlineData("pitch-match:steps@61")] // a doh it is never placed on
    [InlineData("pitch-match:made-up@60")]
    [InlineData("warm-up:breathe")]
    [InlineData("runs:pentatonic@58~85")] // a speed it is never sung at
    [InlineData("runs:pentatonic@58")] // no speed
    [InlineData("intervals:fifth-up@60~100")]
    [InlineData("rhythm:steady@60")]
    [InlineData("intervals:fifth-up@sixty")]
    public void An_id_the_catalogue_never_handed_out_names_nothing(string? id)
        => Assert.Null(ModeCatalogue.Find(id));

    [Fact]
    public void Every_sung_note_is_labelled_by_the_solfa_engine_and_sits_between_A3_and_D5()
    {
        foreach (var e in Everything().Where(e => e.Key is not null))
        {
            Assert.All(e.Notes, n => Assert.InRange(n.PitchMidi, DrillCatalogue.LowestMidi, DrillCatalogue.HighestMidi));
            Assert.All(e.Backing, n => Assert.InRange(n.PitchMidi, ModeCatalogue.BackingLowestMidi, ModeCatalogue.BackingHighestMidi));
            Assert.Equal(e.DohMidi % 12, e.Key!.DohPitchClass);
            Assert.True(KeyParser.Parse(e.KeyName).IsSuccess, e.KeyName);

            var pitches = e.Notes.Select(n => n.PitchMidi).ToList();
            var reference = SolfaMapper.ReferenceDoh(pitches, e.Key.DohPitchClass, e.Key.Mode);
            var ascending = SolfaMapper.AscendingFlags(pitches, e.Key.DohPitchClass);
            for (var i = 0; i < pitches.Count; i++)
            {
                var mapped = SolfaMapper.Map(pitches[i], e.Key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
                Assert.Equal(mapped.Text + mapped.OctaveMark, e.Notes[i].Solfa + e.Notes[i].OctaveMark);
            }
        }
    }

    [Fact]
    public void A_pitch_match_set_is_eight_notes_each_held_four_beats_after_its_tone_and_lined_up_narrowly()
    {
        Assert.Equal(6, ModeCatalogue.PitchMatchSets.Count);
        Assert.Equal(3, ModeCatalogue.PitchMatchSets.Count(s => s.Playful));
        foreach (var e in Everything().Where(e => e.Mode == PracticeModes.PitchMatch))
        {
            Assert.Equal(ModeCatalogue.PitchMatchNotes, e.Notes.Count);
            Assert.Equal(e.Notes.Count, e.Backing.Count);
            for (var i = 0; i < e.Notes.Count; i++)
            {
                var (tone, hold) = (e.Backing[i], e.Notes[i]);
                Assert.Equal(tone.PitchMidi, hold.PitchMidi);
                Assert.Equal(i * 6.0, tone.StartBeat);
                Assert.Equal(2.0, tone.DurBeats);
                Assert.Equal(tone.StartBeat + 2, hold.StartBeat);
                Assert.Equal(4.0, hold.DurBeats);
            }
            Assert.Equal(ModeCatalogue.PitchMatchOffsetSearchSec, e.OffsetSearchSec);
            // The tone must not be reachable by the alignment: two beats away, beyond the search and the grader's head skip.
            Assert.True(ModeCatalogue.PitchMatchToneBeats * e.BeatSeconds > 3 * e.OffsetSearchSec!.Value);
            // A set's whole take (the longest count-in included) is well within the worker's two minutes.
            Assert.InRange(e.MaxTakeSeconds, 50, 120);
        }
    }

    [Fact]
    public void Intervals_come_in_the_order_the_exams_ask_them_each_doh_then_the_note()
    {
        var expected = new (string Code, int Semitones)[]
        {
            ("third-down", -3), ("third-up", 4), ("fifth-up", 7), ("fourth-up", 5), ("fourth-down", -5), ("octave-up", 12),
            ("octave-down", -12), ("sixth-up", 9), ("sixth-down", -8), ("seventh-up", 11), ("seventh-down", -10),
        };
        Assert.Equal(expected.Select(x => x.Code), ModeCatalogue.Intervals.Select(p => p.Code));
        Assert.Equal(5, ModeCatalogue.Intervals.Count(p => p.Playful));

        foreach (var e in Everything().Where(e => e.Mode == PracticeModes.Intervals))
        {
            Assert.Equal(2, e.Notes.Count);
            Assert.Equal(e.Key!.DohPitchClass, e.Notes[0].PitchMidi % 12);
            Assert.Equal("d", e.Notes[0].Solfa);
            Assert.Equal(expected.Single(x => x.Code == e.Code).Semitones, e.Notes[1].PitchMidi - e.Notes[0].PitchMidi);
            Assert.True(e.ShortestNoteSeconds >= PracticeRules.ShortestNoteSeconds);
        }
        var fifth = ModeCatalogue.BuildInterval(ModeCatalogue.Intervals.Single(p => p.Code == "fifth-up"), 60);
        Assert.Equal("Hear doh and sing it, then jump up a fifth to soh.", fifth.Prompt);
    }

    [Fact]
    public void A_harmony_line_is_a_third_above_or_under_the_tune_at_every_note_in_the_tunes_rhythm()
    {
        foreach (var e in Everything().Where(e => e.Mode == PracticeModes.Harmony))
        {
            var line = ModeCatalogue.HarmonyLines.Single(h => h.Code == e.Code);
            Assert.Equal(e.Backing.Count, e.Notes.Count);
            for (var i = 0; i < e.Notes.Count; i++)
            {
                Assert.Equal((e.Backing[i].StartBeat, e.Backing[i].DurBeats), (e.Notes[i].StartBeat, e.Notes[i].DurBeats));
                var third = (line.Above ? 1 : -1) * (e.Notes[i].PitchMidi - e.Backing[i].PitchMidi);
                Assert.Contains(third, new[] { 3, 4 });
            }
            Assert.Null(e.OffsetSearchSec);
            Assert.True(e.ShortestNoteSeconds >= PracticeRules.ShortestNoteSeconds);
        }
    }

    [Fact]
    public void A_run_is_marked_note_by_note_only_where_its_quick_notes_last_long_enough()
    {
        Assert.Equal(12, ModeCatalogue.Runs.Count);
        Assert.All(ModeCatalogue.Runs.GroupBy(r => r.Unit), unit => Assert.Equal(4, unit.Count()));
        foreach (var e in Everything().Where(e => e.Mode == PracticeModes.Runs))
        {
            Assert.Equal(ModeCatalogue.RunTempoAt(e.SpeedPercent!.Value), e.TempoBpm);
            Assert.True(e.Notes[^1].DurBeats >= 2, "a run lands on a held note");
            if (e.Grader == ExerciseGrader.Notes)
                Assert.True(e.ShortestNoteSeconds >= PracticeRules.ShortestNoteSeconds - 1e-9, e.Id);
            else
                Assert.True(e.ShortestNoteSeconds < PracticeRules.ShortestNoteSeconds, e.Id);
        }

        // The board's pentatonic run: 36 BPM at 60 % (quick notes 0.42 s), note by note up to 80 % (48 BPM, 0.31 s).
        var run = ModeCatalogue.Runs.Single(r => r.Code == "pentatonic");
        var doh = ModeCatalogue.Placements(run)[0];
        var speeds = ModeCatalogue.RunSpeeds.Select(p => ModeCatalogue.BuildRun(run, doh, p)).ToList();
        Assert.Equal(new[] { 36, 42, 48, 54, 60 }, speeds.Select(s => s.TempoBpm));
        Assert.Equal(0.42, Math.Round(speeds[0].ShortestNoteSeconds, 2));
        Assert.Equal(new[] { "notes", "notes", "notes", "run", "run" }, speeds.Select(s => s.GraderName));
        Assert.Equal("d' l s m r d", string.Join(' ', speeds[0].Notes.Select(n => n.Solfa + n.OctaveMark)));
        Assert.Equal(speeds.Select(s => s.Id), ModeCatalogue.AtEverySpeed(speeds[2]).Select(s => s.Id));
    }

    [Fact]
    public void A_rhythms_claps_are_whole_bars_and_far_enough_apart_to_mark_each_one()
    {
        Assert.Equal(5, ModeCatalogue.Rhythms.Count(r => r.Playful));
        foreach (var r in ModeCatalogue.Rhythms)
        {
            var e = ModeCatalogue.BuildRhythm(r);
            Assert.Empty(e.Notes);
            Assert.Null(e.Key);
            Assert.Equal(ExerciseGrader.Rhythm, e.Grader);
            var bars = r.Beats.Split(' ').Sum(t => double.Parse(t.TrimStart('r'), System.Globalization.CultureInfo.InvariantCulture));
            Assert.Equal(0, bars % 4);
            var gaps = e.Claps.Zip(e.Claps.Skip(1), (a, b) => (b.StartBeat - a.StartBeat) * e.BeatSeconds);
            // The worker's "close" window is ±140 ms: two claps' windows must not overlap.
            Assert.All(gaps, g => Assert.True(g >= PracticeRules.ShortestNoteSeconds && g > 2 * 0.140, $"{r.Code}: {g}"));
        }
        Assert.Equal(new[] { 0.0, 1.0, 3.0 }, ModeCatalogue.BuildRhythm(ModeCatalogue.Rhythms.Single(r => r.Code == "rest")).Claps.Select(c => c.StartBeat));
    }

    [Fact]
    public void A_track_lists_its_exercises_in_one_key_a_day_for_each_singer()
    {
        var focused = ModeCatalogue.ForTrack(PracticeModes.Intervals, PracticeTrack.Focused, Singer, Today);
        var playful = ModeCatalogue.ForTrack(PracticeModes.Intervals, PracticeTrack.Playful, Singer, Today);
        Assert.Equal(11, focused.Count);
        Assert.Equal(5, playful.Count);
        Assert.Equal(focused.Select(e => e.Id), ModeCatalogue.ForTrack(PracticeModes.Intervals, PracticeTrack.Focused, Singer, Today).Select(e => e.Id));
        // Over a fortnight the keys move.
        var keys = Enumerable.Range(0, 14)
            .Select(d => ModeCatalogue.ForTrack(PracticeModes.PitchMatch, PracticeTrack.Focused, Singer, Today.AddDays(d))[0].DohMidi)
            .Distinct()
            .Count();
        Assert.True(keys > 1);
        Assert.All(ModeCatalogue.ForTrack(PracticeModes.Runs, PracticeTrack.Focused, Singer, Today), e => Assert.Equal(60, e.SpeedPercent));
        Assert.Empty(ModeCatalogue.ForTrack(PracticeModes.WarmUp, PracticeTrack.Focused, Singer, Today));
    }

    // ── The modes each track lists, and their switches ──────────────────────

    [Fact]
    public void Focused_lists_all_six_modes_and_playful_its_four_in_the_hubs_order()
    {
        var on = new PracticeModeSettings();
        Assert.Equal(new[] { "warm-up", "pitch-match", "runs", "intervals", "harmony", "rhythm" }, PracticeModes.Live(PracticeTrack.Focused, on));
        Assert.Equal(PracticeModes.Live(PracticeTrack.Focused, on), PracticeModes.Live(null, on));
        Assert.Equal(new[] { "warm-up", "pitch-match", "intervals", "rhythm" }, PracticeModes.Live(PracticeTrack.Playful, on));
        Assert.Equal(new[] { "warm-up", "pitch-match", "intervals" },
            PracticeModes.Live(PracticeTrack.Playful, new PracticeModeSettings { Rhythm = false }));
    }

    [Fact]
    public void Each_mode_is_switched_off_only_by_false()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["PracticeModes:Rhythm"] = "false",
            ["PracticeModes:Runs"] = "",
            ["PracticeModes:Harmony"] = "true",
            ["PracticeModes:Intervals"] = "nonsense",
        }).Build();
        var settings = PracticeModeDependencyInjection.ResolveSettings(config);
        Assert.False(settings.Rhythm);
        Assert.True(settings.Runs && settings.Harmony && settings.Intervals && settings.WarmUp && settings.PitchMatch);
        Assert.False(settings.IsOn("made-up"));
    }

    // ── Warm up ─────────────────────────────────────────────────────────────

    [Fact]
    public void The_warm_up_is_three_minutes_of_guides_ending_with_the_range_finder()
    {
        var warmUp = WarmUpRoutine.Build();
        Assert.Equal(180, warmUp.TotalSeconds);
        Assert.Equal(new[] { "breathe", "lip-trills", "sirens", "range" }, warmUp.Steps.Select(s => s.Id));
        Assert.Equal(new[] { "breath", "guide", "guide", "range" }, warmUp.Steps.Select(s => s.Kind));

        var breath = warmUp.Steps[0].Breath!;
        Assert.Equal((4, 4, 8), (breath.InCounts, breath.HoldCounts, breath.OutCounts));
        Assert.Equal(warmUp.Steps[0].Seconds, (int)Math.Round(breath.Cycles * (4 + 4 + 8) * 60.0 / breath.CountsPerMinute));

        var trills = warmUp.Steps[1].Guide!;
        Assert.Equal("Doh is C", trills.DohHeader);
        Assert.Equal("d r m f s f m r d", string.Join(' ', trills.Notes.Select(n => n.Solfa + n.OctaveMark)));
        Assert.Equal(WarmUpRoutine.GuideDohMidi, trills.Notes[0].PitchMidi);
        Assert.False(trills.Glide);
        Assert.True(warmUp.Steps[2].Guide!.Glide);
        // The highest round of each guide stays within a comfortable top.
        Assert.All(warmUp.Steps.Where(s => s.Guide is not null),
            s => Assert.True(s.Guide!.Notes.Max(n => n.PitchMidi) + (s.Guide.Rounds - 1) * s.Guide.StepSemitones <= 76));
    }

    // ── The range in words ──────────────────────────────────────────────────

    [Fact]
    public void A_range_is_said_as_two_notes_a_span_solfa_on_C_and_a_choir_part()
    {
        var range = VoiceRanges.Describe(55, 74);
        Assert.Equal(("G3", "D5"), (range.Low, range.High));
        Assert.Equal(19, range.SpanSemitones);
        Assert.Equal("An octave and a fifth", range.Span);
        Assert.Equal("Doh is C", range.DohHeader);
        Assert.Equal(("s,", "r'"), (range.LowSolfa, range.HighSolfa));
        Assert.Equal("alto", range.VoicePart);
    }

    [Theory]
    [InlineData(60, 79, "soprano")] // C4–G5
    [InlineData(55, 74, "alto")] // G3–D5
    [InlineData(48, 67, "tenor")] // C3–G4
    [InlineData(41, 62, "bass")] // F2–D4
    [InlineData(45, 64, "tenor")] // A2–E4: a baritone, nearer the tenor's middle
    public void The_part_suggested_is_the_one_whose_written_range_the_singer_covers_best(int low, int high, string part)
        => Assert.Equal(part, VoiceRanges.SuggestPart(low, high));

    [Fact]
    public void The_parts_ranges_are_harmony_pys()
    {
        // server/app/pipeline/harmony.py: SOPRANO_RANGE (60, 76), ALTO_RANGE (53, 74), TENOR_RANGE (48, 67), BASS_RANGE (40, 60).
        var harmony = File.ReadAllText(Path.Combine(RepoRoot(), "server", "app", "pipeline", "harmony.py"));
        foreach (var p in VoiceRanges.Parts)
            Assert.Contains($"{p.Part.ToUpperInvariant()}_RANGE = ({p.Lowest}, {p.Highest})", harmony);
    }

    [Theory]
    [InlineData(0, "One note")]
    [InlineData(7, "A fifth")]
    [InlineData(9, "A major sixth")]
    [InlineData(12, "An octave")]
    [InlineData(14, "An octave and a tone")]
    [InlineData(24, "Two octaves")]
    [InlineData(27, "Two octaves and a minor third")]
    public void A_span_is_said_plainly(int semitones, string said) => Assert.Equal(said, VoiceRanges.Span(semitones));

    [Fact]
    public void Notes_are_named_as_key_signatures_spell_them_and_an_end_not_measured_is_null()
    {
        Assert.Equal(new[] { "A3", "Bb3", "F#4", "C4", "Eb5" }, new[] { 57, 58, 66, 60, 75 }.Select(VoiceRanges.Name));
        var half = VoiceRanges.Describe(57, null);
        Assert.Equal("A3", half.Low);
        Assert.Null(half.High);
        Assert.Null(half.VoicePart);
        Assert.Null(half.LowSolfa);
    }

    [Fact]
    public void A_measured_end_that_crosses_the_other_clears_it()
    {
        var user = User.Create("Singer", "range@example.com", "hash", DateTime.UtcNow);
        user.MeasureVoiceRange(low: true, 55);
        user.MeasureVoiceRange(low: false, 74);
        Assert.Equal((55, 74), (user.VoiceRangeLowMidi, user.VoiceRangeHighMidi));
        user.MeasureVoiceRange(low: false, 50); // a "high" note below the low one: the low end is measured again
        Assert.Null(user.VoiceRangeLowMidi);
        Assert.Equal(50, user.VoiceRangeHighMidi);
        Assert.Throws<ArgumentOutOfRangeException>(() => user.MeasureVoiceRange(low: true, 200));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "NoteFusion.slnx")))
            dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("No repository root above the test run.");
    }
}
