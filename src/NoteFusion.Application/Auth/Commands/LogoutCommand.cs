using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

public sealed record LogoutCommand(string RefreshToken) : IRequest<Result>;

public sealed class LogoutCommandValidator : AbstractValidator<LogoutCommand>
{
    public LogoutCommandValidator() => RuleFor(x => x.RefreshToken).NotEmpty();
}

public sealed class LogoutCommandHandler : IRequestHandler<LogoutCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IDateTimeProvider _clock;

    public LogoutCommandHandler(IApplicationDbContext db, IPasswordHasher hasher, IDateTimeProvider clock)
    {
        _db = db;
        _hasher = hasher;
        _clock = clock;
    }

    public async Task<Result> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        if (!CompositeTokenCodec.TryParse(request.RefreshToken, out var tokenId, out var secret))
            return Result.Success(); // already unusable

        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.Id == tokenId, cancellationToken);
        // Same proof as a refresh: the row id travels in the clear half of the token, so without checking
        // the secret anybody who saw an id could sign that session out.
        if (stored is not null && _hasher.Verify(secret, stored.TokenHash))
        {
            stored.Revoke(_clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return Result.Success();
    }
}
