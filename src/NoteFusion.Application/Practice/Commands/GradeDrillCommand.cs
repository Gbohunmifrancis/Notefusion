using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Commands;

/// <summary>
/// A practice drill sung and marked: free for every signed-in account, a session's worth a day
/// (<see cref="PracticeRules.DrillGradesPerDay"/>). The notes are the server's own drill, rebuilt from its id; the
/// take goes to the worker's grader (cut at the drill's length plus a few seconds) and the marked take is recorded
/// as practice, with what it earned — and any path milestone it reached — returned beside the marks. Which drill
/// comes next is read off the recorded takes (<see cref="PracticePath"/>).
/// </summary>
public sealed record GradeDrillCommand(Stream Audio, string FileName, string DrillId) : IRequest<Result<GradeResultDto>>;

public sealed class GradeDrillCommandHandler : IRequestHandler<GradeDrillCommand, Result<GradeResultDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;
    private readonly IQuotaGate _gate;
    private readonly PracticeRecorder _recorder;

    public GradeDrillCommandHandler(
        ITranscriptionApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock,
        IClientTimeZone timeZone, IQuotaGate gate, PracticeRecorder recorder)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _timeZone = timeZone;
        _gate = gate;
        _recorder = recorder;
    }

    public async Task<Result<GradeResultDto>> Handle(GradeDrillCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (DrillCatalogue.Find(request.DrillId) is not { } drill)
            return PracticeErrors.DrillNotFound;

        var today = PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current));

        // Count, grade and record under one lock, so two takes sent at once cannot both fit under the limit.
        await using var lease = await _gate.AcquireAsync(PracticeRecorder.GateKey(userId), cancellationToken);

        var used = await _db.PracticeSessions.CountAsync(
            s => s.UserId == userId && s.Kind == PracticeKind.Drill && s.LocalDate == today, cancellationToken);
        var limit = PracticeRules.DrillGradesPerDay(await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken));
        if (used >= limit)
            return PracticeErrors.DailyDrillLimit(limit);

        var graded = await _api.GradeAsync(request.Audio, request.FileName, drill.Target(), drill.MaxTakeSeconds, cancellationToken);
        if (graded.IsFailure)
            return graded.Error;

        var grade = graded.Value;
        var session = PracticeSession.Record(
            userId, PracticeKind.Drill, grade.Score, grade.Hits, grade.Near, grade.Wrong, grade.Missed,
            drill.PassageSeconds, _clock.UtcNow, today, drillId: drill.Id);
        var reward = await _recorder.RecordAsync(session, cancellationToken);

        // The path read again with this take on it: a milestone it reached is reported by this take alone.
        var facts = await PracticeRecorder.FactsAsync(_db, userId, cancellationToken);
        var reading = await PracticePathReader.ReadAsync(_db, userId, facts, cancellationToken);
        var milestone = reading.ReachedBy(session.Id) is { } reached ? PracticePathReader.Describe(reached) : null;
        return grade with { Reward = reward, Milestone = milestone };
    }
}
