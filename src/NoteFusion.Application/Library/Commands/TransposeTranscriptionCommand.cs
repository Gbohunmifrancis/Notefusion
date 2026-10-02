using System.Xml;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Transpose for a choir's range. Unlike a key override this moves the notes — every pitch in the
/// melody and the parts, the key, and both engraved scores — while the solfa reads exactly as
/// before, because in movable-do only Doh moves.
/// </summary>
public sealed record TransposeTranscriptionCommand(Guid Id, int Semitones) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class TransposeTranscriptionCommandValidator : AbstractValidator<TransposeTranscriptionCommand>
{
    public TransposeTranscriptionCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Semitones).InclusiveBetween(-12, 12);
    }
}

public sealed class TransposeTranscriptionCommandHandler : IRequestHandler<TransposeTranscriptionCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public TransposeTranscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(TransposeTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        if (request.Semitones is < -12 or > 12)
            return LibraryErrors.InvalidTransposition;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        try
        {
            item.Transpose(request.Semitones);
        }
        catch (XmlException)
        {
            return LibraryErrors.InvalidScore;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
