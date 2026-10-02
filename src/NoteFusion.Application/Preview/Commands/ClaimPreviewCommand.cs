using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Preview.Commands;

/// <summary>
/// A signed-in account says "that preview was mine": the conversion event the funnel counts.
/// Idempotent, and tolerant of a job id it has never seen (an old tab) — claiming changes nothing
/// about what the account may do, so there is nothing to refuse.
/// </summary>
public sealed record ClaimPreviewCommand(string JobId) : IRequest<Result>;

public sealed class ClaimPreviewCommandHandler : IRequestHandler<ClaimPreviewCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public ClaimPreviewCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result> Handle(ClaimPreviewCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var preview = await _db.PreviewJobs.FirstOrDefaultAsync(p => p.JobId == request.JobId, cancellationToken);
        if (preview is not null && preview.Claim(userId, _clock.UtcNow))
            await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}
