using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// User key override (F-03). A pure re-labelling: solfa is re-derived from the note list on next
/// render; the stored notes never change. This is the solfa engine's core promise made durable.
/// </summary>
public sealed record UpdateTranscriptionKeyCommand(Guid Id, string Key) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionKeyCommandValidator : AbstractValidator<UpdateTranscriptionKeyCommand>
{
    public UpdateTranscriptionKeyCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Key).NotEmpty();
    }
}

public sealed class UpdateTranscriptionKeyCommandHandler : IRequestHandler<UpdateTranscriptionKeyCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateTranscriptionKeyCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionKeyCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var keyResult = KeyParser.Parse(request.Key);
        if (keyResult.IsFailure)
            return LibraryErrors.InvalidKey;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.OverrideKey(keyResult.Value);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
