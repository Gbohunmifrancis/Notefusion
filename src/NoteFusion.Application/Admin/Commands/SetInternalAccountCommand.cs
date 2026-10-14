using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Marks an account as the team's own (or a test account), or back to a customer. Internal accounts are
/// left out of every analytics figure, chart and list in the console (<c>AnalyticsScope</c>), as admins
/// already are; the account itself works exactly as before.
/// <para>Idempotent: setting the value it already has succeeds and writes nothing.</para>
/// </summary>
public sealed record SetInternalAccountCommand(Guid UserId, bool IsInternal, string? Note = null) : IRequest<Result>;

public sealed class SetInternalAccountCommandHandler : IRequestHandler<SetInternalAccountCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public SetInternalAccountCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result> Handle(SetInternalAccountCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;
        if (user.IsInternal == request.IsInternal)
            return Result.Success();

        user.SetInternal(request.IsInternal);
        _audit.Record(
            AdminAuditAction.SetInternalAccount,
            user,
            request.IsInternal ? "Marked as a team/test account: left out of analytics." : "Marked as a customer: counted in analytics.",
            request.Note);
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
