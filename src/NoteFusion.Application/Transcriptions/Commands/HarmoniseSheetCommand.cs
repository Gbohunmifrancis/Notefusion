using FluentValidation;
using MediatR;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Writes alto, tenor and bass under a melody the client already holds — a fresh transcription or a
/// saved sheet. Pro only, and only on request: a hummed or sung line is one voice, and parts composed
/// under it are an arrangement the user asks for, never something a transcription carries unasked.
/// Nothing is stored here; a saved sheet keeps its parts through <c>PUT api/library/{id}/parts</c>.
/// </summary>
public sealed record HarmoniseSheetCommand(
    string Key,
    int TempoBpm,
    string TimeSignature,
    IReadOnlyList<NoteEventDto> Notes) : IRequest<Result<HarmonyDto>>;

public sealed class HarmoniseSheetCommandValidator : AbstractValidator<HarmoniseSheetCommand>
{
    public HarmoniseSheetCommandValidator()
    {
        RuleFor(x => x.Key).NotEmpty();
        RuleFor(x => x.TempoBpm).InclusiveBetween(20, 400);
        RuleFor(x => x.TimeSignature).NotEmpty().Matches(@"^\d{1,2}/\d{1,2}$");
        // The harmoniser's cost is beats × notes: a six-minute song at 400 BPM is 2400 beats.
        RuleFor(x => x.Notes).NotEmpty().Must(n => n.Count <= 5000).WithMessage("At most 5000 notes can be harmonised at once.");
        RuleForEach(x => x.Notes).Must(n => n.StartBeat >= 0 && n.DurBeats > 0 && n.StartBeat + n.DurBeats <= 2400)
            .WithMessage("Notes must start at or after beat 0, last longer than nothing and end by beat 2400.");
    }
}

public sealed class HarmoniseSheetCommandHandler : IRequestHandler<HarmoniseSheetCommand, Result<HarmonyDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public HarmoniseSheetCommandHandler(ITranscriptionApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<HarmonyDto>> Handle(HarmoniseSheetCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (!await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken))
            return TranscriptionErrors.HarmonyProRequired;
        if (KeyParser.Parse(request.Key).IsFailure)
            return LibraryErrors.InvalidKey;

        return await _api.HarmoniseAsync(request.Key, request.TempoBpm, request.TimeSignature, request.Notes, cancellationToken);
    }
}
