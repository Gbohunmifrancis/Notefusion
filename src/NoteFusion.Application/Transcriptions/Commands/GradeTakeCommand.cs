using FluentValidation;
using MediatR;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Sing-along grading: a chorister's recorded take, judged against the part they were singing.
/// Pro only — it is the feature that makes the app a rehearsal tool rather than a transcriber.
/// Nothing is stored: the take goes to the worker, which deletes it, and the marks come back.
/// </summary>
public sealed record GradeTakeCommand(Stream Audio, string FileName, GradeTargetDto Target) : IRequest<Result<GradeResultDto>>;

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

    public GradeTakeCommandHandler(ITranscriptionApi api, IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<GradeResultDto>> Handle(GradeTakeCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (!await ProStatus.IsProAsync(_db, _clock, userId, cancellationToken))
            return TranscriptionErrors.ProRequired;
        if (request.Target.Notes.Count == 0)
            return TranscriptionErrors.InvalidAudio;

        return await _api.GradeAsync(request.Audio, request.FileName, request.Target, cancellationToken);
    }
}
