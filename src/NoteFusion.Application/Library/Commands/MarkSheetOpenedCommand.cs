using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// The owner opened a sheet (<c>POST /api/library/{id}/opened</c>): a sheet saved automatically stops being
/// "unopened" in the clients and starts counting as kept. Idempotent; the first open stands.
/// </summary>
public sealed record MarkSheetOpenedCommand(Guid Id) : IRequest<Result>;

public sealed class MarkSheetOpenedCommandHandler : IRequestHandler<MarkSheetOpenedCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public MarkSheetOpenedCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result> Handle(MarkSheetOpenedCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        if (item.OpenedAtUtc is null)
        {
            item.MarkOpened(_clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
        }
        return Result.Success();
    }
}
