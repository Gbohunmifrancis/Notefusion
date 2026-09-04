using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

public sealed record RefreshTokenCommand(string RefreshToken) : IRequest<Result<TokenPairResponse>>;

public sealed class RefreshTokenCommandValidator : AbstractValidator<RefreshTokenCommand>
{
    public RefreshTokenCommandValidator() => RuleFor(x => x.RefreshToken).NotEmpty();
}

public sealed class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, Result<TokenPairResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IDateTimeProvider _clock;

    public RefreshTokenCommandHandler(
        IApplicationDbContext db, IPasswordHasher hasher, ITokenIssuer tokenIssuer, IDateTimeProvider clock)
    {
        _db = db;
        _hasher = hasher;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
    }

    public async Task<Result<TokenPairResponse>> Handle(RefreshTokenCommand request, CancellationToken cancellationToken)
    {
        if (!CompositeTokenCodec.TryParse(request.RefreshToken, out var tokenId, out var secret))
            return AuthErrors.InvalidRefreshToken;

        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.Id == tokenId, cancellationToken);
        var now = _clock.UtcNow;
        if (stored is null || !stored.IsActive(now) || !_hasher.Verify(secret, stored.TokenHash))
            return AuthErrors.InvalidRefreshToken;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == stored.UserId, cancellationToken);
        if (user is null || !user.IsActive)
            return AuthErrors.InvalidRefreshToken;

        user.RecordSuccessfulLogin(now);

        var tokens = _tokenIssuer.Issue(user);

        // Link the rotated token so the chain is auditable, then revoke the one just used.
        CompositeTokenCodec.TryParse(tokens.RefreshToken, out var newTokenId, out _);
        stored.Revoke(now, newTokenId);

        await _db.SaveChangesAsync(cancellationToken);
        return tokens;
    }
}
