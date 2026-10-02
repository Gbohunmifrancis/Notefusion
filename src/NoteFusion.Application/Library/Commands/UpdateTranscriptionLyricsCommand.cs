using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>The words under the solfa, stored as typed; the clients syllabify them per note.</summary>
public sealed record UpdateTranscriptionLyricsCommand(Guid Id, string Lyrics) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionLyricsCommandValidator : AbstractValidator<UpdateTranscriptionLyricsCommand>
{
    public UpdateTranscriptionLyricsCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Lyrics).NotNull().MaximumLength(20_000);
    }
}

public sealed class UpdateTranscriptionLyricsCommandHandler : IRequestHandler<UpdateTranscriptionLyricsCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateTranscriptionLyricsCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionLyricsCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.SetLyrics(request.Lyrics);
        await _db.SaveChangesAsync(cancellationToken);
        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
