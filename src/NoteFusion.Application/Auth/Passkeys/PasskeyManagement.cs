using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Passkeys;

/// <summary>A passkey as its owner sees it in the console. Nothing about the key itself.</summary>
public sealed record PasskeyDto(Guid Id, string Name, DateTime CreatedAtUtc, DateTime? LastUsedAtUtc)
{
    public static PasskeyDto From(Passkey passkey)
        => new(passkey.Id, passkey.Name, passkey.CreatedAtUtc, passkey.LastUsedAtUtc);
}

/// <summary>The signed-in account's own passkeys, newest first.</summary>
public sealed record GetMyPasskeysQuery : IRequest<Result<IReadOnlyList<PasskeyDto>>>;

public sealed class GetMyPasskeysQueryHandler : IRequestHandler<GetMyPasskeysQuery, Result<IReadOnlyList<PasskeyDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GetMyPasskeysQueryHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<IReadOnlyList<PasskeyDto>>> Handle(GetMyPasskeysQuery request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var rows = await _db.Passkeys.AsNoTracking()
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.CreatedAtUtc)
            .Select(p => new PasskeyDto(p.Id, p.Name, p.CreatedAtUtc, p.LastUsedAtUtc))
            .ToListAsync(ct);

        return Result.Success<IReadOnlyList<PasskeyDto>>(rows);
    }
}

/// <summary>Renames one of the caller's own passkeys.</summary>
public sealed record RenamePasskeyCommand(Guid Id, string Name) : IRequest<Result<PasskeyDto>>;

public sealed class RenamePasskeyCommandValidator : AbstractValidator<RenamePasskeyCommand>
{
    public RenamePasskeyCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Give the passkey a name.")
            .MaximumLength(Passkey.NameMaxLength)
            .WithMessage($"Keep the name to {Passkey.NameMaxLength} characters or fewer.");
    }
}

public sealed class RenamePasskeyCommandHandler : IRequestHandler<RenamePasskeyCommand, Result<PasskeyDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public RenamePasskeyCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<PasskeyDto>> Handle(RenamePasskeyCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        // Someone else's passkey is "not found", the same as one that does not exist.
        var passkey = await _db.Passkeys.FirstOrDefaultAsync(p => p.Id == request.Id && p.UserId == userId, ct);
        if (passkey is null)
            return PasskeyErrors.NotFound;

        passkey.Rename(request.Name);
        await _db.SaveChangesAsync(ct);
        return PasskeyDto.From(passkey);
    }
}

/// <summary>
/// Removes one of the caller's own passkeys. The password still signs in, so removing the last one locks
/// nobody out.
/// </summary>
public sealed record DeletePasskeyCommand(Guid Id) : IRequest<Result>;

public sealed class DeletePasskeyCommandHandler : IRequestHandler<DeletePasskeyCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public DeletePasskeyCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result> Handle(DeletePasskeyCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return AdminErrors.NotAuthenticated;

        var passkey = await _db.Passkeys.FirstOrDefaultAsync(p => p.Id == request.Id && p.UserId == userId, ct);
        if (passkey is null)
            return PasskeyErrors.NotFound;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);

        _db.Passkeys.Remove(passkey);
        _audit.Record(AdminAuditAction.RemovePasskey, user, $"Removed the passkey \"{passkey.Name}\".");
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
