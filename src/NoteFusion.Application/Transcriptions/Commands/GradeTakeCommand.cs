using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Sing-along grading: a chorister's recorded take, judged against the part they were singing.
/// Pro only — it is the feature that makes the app a rehearsal tool rather than a transcriber.
/// The take goes to the worker, which deletes it; what is kept is the mark, as a part practice
/// (<see cref="PracticeSession"/>) that counts toward the singer's XP and streak, returned as the grade's reward.
/// <paramref name="TranscriptionId"/> and <paramref name="Part"/> name what was practised when the client knows:
/// a saved sheet the singer can open, and "soprano"/"alto"/"tenor"/"bass" (or S/A/T/B).
/// </summary>
public sealed record GradeTakeCommand(
    Stream Audio,
    string FileName,
    GradeTargetDto Target,
    Guid? TranscriptionId = null,
    string? Part = null) : IRequest<Result<GradeResultDto>>;

public sealed class GradeTakeCommandValidator : AbstractValidator<GradeTakeCommand>
{
    public GradeTakeCommandValidator()
    {
        RuleFor(x => x.Target).NotNull();
        RuleFor(x => x.Target.Notes).NotEmpty().When(x => x.Target is not null);
        RuleFor(x => x.Target.TempoBpm).InclusiveBetween(20, 300).When(x => x.Target is not null);
        RuleFor(x => x.Target.LeadInSec).InclusiveBetween(0, 60).When(x => x.Target is not null);
    }
}

public sealed class GradeTakeCommandHandler : IRequestHandler<GradeTakeCommand, Result<GradeResultDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientTimeZone _timeZone;
    private readonly IQuotaGate _gate;
    private readonly PracticeRecorder _recorder;

    public GradeTakeCommandHandler(
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

    public async Task<Result<GradeResultDto>> Handle(GradeTakeCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (!await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken))
            return TranscriptionErrors.ProRequired;
        if (request.Target.Notes.Count == 0)
            return TranscriptionErrors.InvalidAudio;

        var graded = await _api.GradeAsync(request.Audio, request.FileName, request.Target, cancellationToken: cancellationToken);
        if (graded.IsFailure)
            return graded;

        var grade = graded.Value;
        var part = PartLetter(request.Part);
        var (sheetId, wholePart) = await SheetAsync(userId, request.TranscriptionId, part, request.Target.Notes.Count, cancellationToken);
        var end = request.Target.Notes.Max(n => n.StartBeat + Math.Max(0, n.DurBeats));
        var session = PracticeSession.Record(
            userId, PracticeKind.Part, grade.Score, grade.Hits, grade.Near, grade.Wrong, grade.Missed,
            end * 60.0 / request.Target.TempoBpm,
            _clock.UtcNow,
            PracticeTime.LocalDate(_clock.UtcNow, PracticeTime.Resolve(_timeZone.Current)),
            transcriptionId: sheetId,
            part: part,
            wholePart: wholePart);

        await using (await _gate.AcquireAsync(PracticeRecorder.GateKey(userId), cancellationToken))
        {
            var season = (await Flags.FeatureFlags.SeasonForCallerAsync(_db, _clock.UtcNow, _currentUser, cancellationToken))?.Key;
            var reward = await _recorder.RecordAsync(session, season, cancellationToken);
            return grade with { Reward = reward };
        }
    }

    /// <summary>"soprano"/"S" → "S", and so on; anything else is no part named.</summary>
    public static string? PartLetter(string? part) => part?.Trim().ToLowerInvariant() switch
    {
        "s" or "soprano" => "S",
        "a" or "alto" => "A",
        "t" or "tenor" => "T",
        "b" or "bass" => "B",
        _ => null
    };

    /// <summary>
    /// The saved sheet practised, when the singer may open it (their own, or one shared with their choir), and
    /// whether the take covered every note of the part: the tune for S, else that harmony part. A sheet they
    /// cannot open is not recorded at all, rather than recorded under an id that is not theirs.
    /// </summary>
    private async Task<(Guid? SheetId, bool WholePart)> SheetAsync(
        Guid userId, Guid? transcriptionId, string? part, int notesSung, CancellationToken ct)
    {
        if (transcriptionId is not { } id)
            return (null, false);

        var choirId = (await ChoirAccess.FindAsync(_db, userId, _clock.UtcNow, ct))?.Choir.Id;
        var sheet = await _db.Transcriptions
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id && (t.UserId == userId || (choirId != null && t.ChoirId == choirId)), ct);
        if (sheet is null)
            return (null, false);

        IReadOnlyList<NoteEvent>? notes = part switch
        {
            "S" => sheet.Notes,
            "A" => sheet.Parts?.GetValueOrDefault("alto"),
            "T" => sheet.Parts?.GetValueOrDefault("tenor"),
            "B" => sheet.Parts?.GetValueOrDefault("bass"),
            _ => null
        };
        var inPart = notes?.Count(n => n.PitchMidi > 0) ?? 0;
        return (sheet.Id, inPart > 0 && notesSung >= inPart);
    }
}
