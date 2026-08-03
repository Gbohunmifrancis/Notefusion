using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

public sealed record RenameTranscriptionCommand(Guid Id, string Title) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class RenameTranscriptionCommandValidator : AbstractValidator<RenameTranscriptionCommand>
{
    public RenameTranscriptionCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(120);
    }
}

public sealed class RenameTranscriptionCommandHandler : IRequestHandler<RenameTranscriptionCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public RenameTranscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(RenameTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.Rename(request.Title.Trim());
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(item, includeNotes: false);
    }
}
