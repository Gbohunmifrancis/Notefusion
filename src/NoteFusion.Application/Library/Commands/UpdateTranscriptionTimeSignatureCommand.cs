using System.Text.RegularExpressions;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// User time signature override. Updates the meter for a saved transcription.
/// </summary>
public sealed record UpdateTranscriptionTimeSignatureCommand(Guid Id, string TimeSignature) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionTimeSignatureCommandValidator : AbstractValidator<UpdateTranscriptionTimeSignatureCommand>
{
    public UpdateTranscriptionTimeSignatureCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.TimeSignature)
            .NotEmpty()
            .Matches(@"^\d{1,2}/\d{1,2}$")
            .WithMessage("Time signature must be in format N/D (e.g. 4/4, 3/4, 6/8).");
    }
}

public sealed class UpdateTranscriptionTimeSignatureCommandHandler : IRequestHandler<UpdateTranscriptionTimeSignatureCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private static readonly Regex MeterRegex = new(@"^\d{1,2}/\d{1,2}$", RegexOptions.Compiled);

    public UpdateTranscriptionTimeSignatureCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionTimeSignatureCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        if (string.IsNullOrWhiteSpace(request.TimeSignature) || !MeterRegex.IsMatch(request.TimeSignature))
            return LibraryErrors.InvalidTimeSignature;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.SetTimeSignature(request.TimeSignature);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
