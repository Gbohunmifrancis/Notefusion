using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// User tempo override (F-07). Updates the playback tempo and beat calculations
/// for a saved transcription.
/// </summary>
public sealed record UpdateTranscriptionTempoCommand(Guid Id, int TempoBpm) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionTempoCommandValidator : AbstractValidator<UpdateTranscriptionTempoCommand>
{
    public UpdateTranscriptionTempoCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.TempoBpm).InclusiveBetween(20, 300);
    }
}

public sealed class UpdateTranscriptionTempoCommandHandler : IRequestHandler<UpdateTranscriptionTempoCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateTranscriptionTempoCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionTempoCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        if (request.TempoBpm < 20 || request.TempoBpm > 300)
            return LibraryErrors.InvalidTempo;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.SetTempo(request.TempoBpm);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
