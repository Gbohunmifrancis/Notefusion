using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Attaches (or removes, with null) the four parts written for a saved sheet after it was saved. The
/// parts are written on request (<c>POST api/transcriptions/harmonise</c>), so a sheet saved before the
/// user asked for them needs this to keep them.
/// </summary>
public sealed record UpdateTranscriptionPartsCommand(
    Guid Id,
    IReadOnlyDictionary<string, PartDto>? Parts,
    string? PartsMusicXml) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionPartsCommandValidator : AbstractValidator<UpdateTranscriptionPartsCommand>
{
    public UpdateTranscriptionPartsCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
    }
}

public sealed class UpdateTranscriptionPartsCommandHandler : IRequestHandler<UpdateTranscriptionPartsCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateTranscriptionPartsCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionPartsCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.SetParts(PartNotes.FromDtos(request.Parts), request.PartsMusicXml);
        await _db.SaveChangesAsync(cancellationToken);
        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
