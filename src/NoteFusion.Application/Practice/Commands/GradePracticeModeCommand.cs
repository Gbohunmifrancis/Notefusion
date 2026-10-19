using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// A practice mode's take, marked and recorded (<c>POST /api/practice/modes/grade</c>): a pitch-match set, an interval, a
/// harmony line, a run at one speed or a rhythm. The exercise is the server's own, rebuilt from its id; the take goes
/// to the grader the exercise names — the drill grader note by note (pitch match with its narrow alignment), the run
/// grader for a run too quick to mark note by note, the onset grader for claps — and the mark is recorded as a
/// <see cref="PracticeSession"/> of the mode's kind on the singer's day. It spends one of the day's marked drills
/// (<see cref="PracticeRules.DrillGradesPerDay"/>, shared with the path) and earns as a drill does; it never moves the
/// path. <see cref="LeadInSec"/> (the count-in before beat one, at most the drills' eight beats) is required.
/// </summary>
public sealed record GradePracticeModeCommand(Stream Audio, string FileName, string ExerciseId, double? LeadInSec)
    : IRequest<Result<PracticeModeGradeDto>>;

public sealed class GradePracticeModeCommandHandler : IRequestHandler<GradePracticeModeCommand, Result<PracticeModeGradeDto>>
{
    private readonly IPracticeAudioApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;
    private readonly IQuotaGate _gate;
    private readonly PracticeRecorder _recorder;
    private readonly PracticeModeSettings _modes;

    public GradePracticeModeCommandHandler(
        IPracticeAudioApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock,
        IClientTimeZone timeZone, IQuotaGate gate, PracticeRecorder recorder, PracticeModeSettings modes)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _gate = gate;
        _recorder = recorder;
        _modes = modes;
    }

    public async Task<Result<PracticeModeGradeDto>> Handle(GradePracticeModeCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (ModeCatalogue.Find(request.ExerciseId) is not { } exercise)
            return PracticeErrors.ExerciseNotFound;
        if (!_modes.IsOn(exercise.Mode))
            return PracticeErrors.ModeOff;
        if (request.LeadInSec is not { } leadIn || !double.IsFinite(leadIn) || leadIn < 0 || leadIn > exercise.MaxLeadInSeconds + 1e-6)
            return PracticeErrors.LeadIn;

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));

        // Count, mark and record under the account's practice lock, as a drill is: two takes at once cannot both fit.
        await using var lease = await _gate.AcquireAsync(PracticeRecorder.GateKey(userId), cancellationToken);

        var used = await _db.PracticeSessions.CountAsync(
            s => s.UserId == userId && PracticeRules.DrillAllowanceKinds.Contains(s.Kind) && s.LocalDate == today, cancellationToken);
        var limit = PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken));
        if (used >= limit)
            return PracticeErrors.DailyDrillLimit(limit);

        var maxTake = exercise.MaxTakeSecondsAfter(leadIn);
        Mark mark;
        switch (exercise.Grader)
        {
            case ExerciseGrader.Run:
            {
                var run = await _api.GradeRunAsync(request.Audio, request.FileName, exercise.Target(leadIn), maxTake, cancellationToken);
                if (run.IsFailure)
                    return run.Error;
                mark = Mark.Of(run.Value);
                break;
            }
            case ExerciseGrader.Rhythm:
            {
                var rhythm = await _api.GradeRhythmAsync(
                    request.Audio, request.FileName, exercise.Claps.Select(c => c.StartBeat).ToList(), exercise.TempoBpm, leadIn, maxTake,
                    cancellationToken);
                if (rhythm.IsFailure)
                    return rhythm.Error;
                mark = Mark.Of(rhythm.Value);
                break;
            }
            default:
            {
                var notes = await _api.GradeNotesAsync(
                    request.Audio, request.FileName, exercise.Target(leadIn), maxTake, exercise.OffsetSearchSec, cancellationToken);
                if (notes.IsFailure)
                    return notes.Error;
                mark = Mark.Of(notes.Value);
                break;
            }
        }

        var session = PracticeSession.Record(
            userId, exercise.Kind, mark.Score, mark.Hits, mark.Near, mark.Wrong, mark.Missed,
            exercise.PassageSeconds, _clock.UtcNow, today, drillId: exercise.Id);
        var season = (await Flags.FeatureFlags.SeasonForCallerAsync(_db, _clock.UtcNow, _currentUser, cancellationToken))?.Key;
        var reward = await _recorder.RecordAsync(session, season, cancellationToken);

        return new PracticeModeGradeDto(
            exercise.Mode, exercise.Id, exercise.GraderName, mark.Score, mark.Summary, exercise.SpeedPercent,
            mark.Notes, mark.Run, mark.Rhythm, reward);
    }

    /// <summary>A grader's answer as a practice row counts it, whichever grader it was.</summary>
    private sealed record Mark(
        int Score, int Hits, int Near, int Wrong, int Missed, string Summary,
        GradeResultDto? Notes = null, RunGradeDto? Run = null, RhythmGradeDto? Rhythm = null)
    {
        public static Mark Of(GradeResultDto g) => new(g.Score, g.Hits, g.Near, g.Wrong, g.Missed, g.Summary, Notes: g);

        /// <summary>A run: each note followed is a hit and the landing note counts as itself (in tune, close, wrong, missed).</summary>
        public static Mark Of(RunGradeDto r) => new(
            r.Score,
            r.Notes.Count(n => n.Followed) + (r.Landing == "hit" ? 1 : 0),
            r.Landing == "near" ? 1 : 0,
            r.Notes.Count(n => n.Status == "wrong") + (r.Landing == "wrong" ? 1 : 0),
            r.Notes.Count(n => n.Status == "missed") + (r.Landing == "missed" ? 1 : 0),
            r.Summary,
            Run: r);

        /// <summary>A rhythm: claps in time are hits, close ones near, extra claps wrong.</summary>
        public static Mark Of(RhythmGradeDto r) => new(r.Score, r.Hits, r.Near, r.Extra, r.Missed, r.Summary, Rhythm: r);
    }
}
