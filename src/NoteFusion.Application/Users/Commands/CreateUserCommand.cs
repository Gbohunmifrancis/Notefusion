using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Users.Commands;

/// <summary>Admin-only: creates a user account with a temporary password.</summary>
public sealed record CreateUserCommand(string FullName, string Email, string Password) : IRequest<Result<Guid>>;

public sealed class CreateUserCommandValidator : AbstractValidator<CreateUserCommand>
{
    public CreateUserCommandValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(254);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8);
    }
}

public sealed class CreateUserCommandHandler : IRequestHandler<CreateUserCommand, Result<Guid>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IDateTimeProvider _clock;
    private readonly IAuditLogger _audit;

    public CreateUserCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, IDateTimeProvider clock, IAuditLogger audit)
    {
        _db = db;
        _hasher = hasher;
        _clock = clock;
        _audit = audit;
    }

    public async Task<Result<Guid>> Handle(CreateUserCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (await _db.Users.AnyAsync(u => u.Email == email, cancellationToken))
            return UserErrors.EmailAlreadyExists;

        var user = User.Create(request.FullName.Trim(), email, _hasher.Hash(request.Password), _clock.UtcNow);
        _db.Users.Add(user);

        // An account that exists because an operator typed a password into a console is worth a trail
        // entry: it is the one account whose credentials somebody other than its owner has seen.
        _audit.Record(AdminAuditAction.CreateUser, user, "Created the account with a temporary password.");

        await _db.SaveChangesAsync(cancellationToken);

        return user.Id;
    }
}
