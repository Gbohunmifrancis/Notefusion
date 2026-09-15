using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Resets an account's consumed free-trial generations by clearing the trial charge on their past jobs.
/// Allows support to unblock a user whose quota was spent on failed or corrupted audio files.
/// </summary>
public sealed record ResetUserTrialQuotaCommand(Guid UserId, string? Note = null) : IRequest<Result<int>>;

public sealed class ResetUserTrialQuotaCommandHandler : IRequestHandler<ResetUserTrialQuotaCommand, Result<int>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public ResetUserTrialQuotaCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IAuditLogger audit,
        IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result<int>> Handle(ResetUserTrialQuotaCommand request, CancellationToken ct)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        var consumedJobs = await _db.TranscriptionJobs
            .Where(j => j.UserId == request.UserId && j.TrialConsumedAtUtc != null)
            .ToListAsync(ct);

        foreach (var job in consumedJobs)
        {
            job.ResetTrial();
        }

        var clearedCount = consumedJobs.Count;

        _audit.Record(
            AdminAuditAction.ResetTrialQuota,
            user,
            $"Reset free-trial usage ({clearedCount} generation(s) restored).",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success(clearedCount);
    }
}
