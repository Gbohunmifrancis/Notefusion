using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Emails an account a password-reset link on an operator's behalf — the support answer to "I can't get in
/// and the reset email never arrives".
/// </summary>
/// <remarks>
/// It delegates to <see cref="ForgotPasswordCommand"/> rather than minting a token of its own, so there is
/// one implementation of what a reset token is and how long it lives. The operator supplies a user id
/// instead of an email: they are looking at an account, and resolving the address here means a typo cannot
/// silently mail a stranger. The link's destination is fixed by configuration, so nothing about this path
/// lets an operator choose where a token is delivered either.
/// </remarks>
public sealed record SendPasswordResetCommand(Guid UserId, string? Note = null) : IRequest<Result>;

public sealed class SendPasswordResetCommandHandler : IRequestHandler<SendPasswordResetCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly ISender _sender;

    public SendPasswordResetCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, ISender sender)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _sender = sender;
    }

    public async Task<Result> Handle(SendPasswordResetCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        // Staged before the inner command runs, because that handler saves — which commits this row in the
        // same transaction as the reset token it stores. The alternative, auditing afterwards, would leave a
        // window where a token exists with no record of who caused it.
        _audit.Record(
            AdminAuditAction.SendPasswordReset,
            user,
            "Emailed a password-reset link.",
            request.Note);

        var sent = await _sender.Send(new ForgotPasswordCommand(user.Email), ct);
        if (sent.IsFailure)
            return sent.Error; // nothing was saved, so the staged row dies with the request scope

        // A no-op when the inner handler already saved, and the safety net if it ever stops doing so.
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
