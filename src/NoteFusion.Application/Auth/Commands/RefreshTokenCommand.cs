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

/// <remarks>
/// <para>
/// A refresh token is spent exactly once. The presented row is revoked with a conditional update
/// (<c>WHERE Id = @id AND NOT IsRevoked</c>) before anything is issued, so two requests racing with the same
/// token cannot both win: the database decides, and the loser is told the token is invalid.
/// </para>
/// <para>
/// A token that was already rotated coming back is either a client that sent the same refresh twice — two
/// tabs, a retry on a dropped response — or somebody else holding a copy. The two are told apart by how
/// long ago it was rotated and whether its successor has been used: within <see cref="ReuseGrace"/>, or
/// while the successor is still unused (the rotation's answer was lost), it is simply refused; a later
/// replay of a chain that has moved on is treated as theft and every token the user holds is revoked,
/// which signs the thief out along with the user (who signs back in with their password).
/// </para>
/// </remarks>
public sealed class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, Result<TokenPairResponse>>
{
    /// <summary>How long after rotation a repeat of the old token is put down to the client, not a thief.</summary>
    public static readonly TimeSpan ReuseGrace = TimeSpan.FromSeconds(30);

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

        // The secret is checked before anything else is decided, so knowing a row id alone can neither
        // spend a token nor set off the theft response below.
        if (stored is null || !_hasher.Verify(secret, stored.TokenHash))
            return AuthErrors.InvalidRefreshToken;

        if (stored.IsRevoked)
        {
            // Only a token spent by rotation counts: one revoked by logout or a password change was never
            // handed a successor, and presenting it again says nothing about a copy.
            if (stored.ReplacedByTokenId is { } successorId && stored.RevokedAt is { } revokedAt && now - revokedAt > ReuseGrace)
            {
                // A successor nobody has used yet means the answer to that rotation never arrived (a timeout
                // on a weak connection, the app killed mid-save): the client is replaying its last good token.
                // Refusing is enough. Only once the successor has itself been spent are two parties holding
                // the chain, and that is theft.
                var successorSpent = await _db.RefreshTokens
                    .AnyAsync(t => t.Id == successorId && t.IsRevoked, cancellationToken);
                if (successorSpent)
                    await RefreshTokenRevocation.RevokeAllAsync(_db, stored.UserId, now, cancellationToken);
            }

            return AuthErrors.InvalidRefreshToken;
        }

        if (!stored.IsActive(now))
            return AuthErrors.InvalidRefreshToken;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == stored.UserId, cancellationToken);
        if (user is null || !user.IsActive)
            return AuthErrors.InvalidRefreshToken;

        // Claim the token. Zero rows means another request spent it between the read above and now.
        var claimed = await _db.RefreshTokens
            .Where(t => t.Id == stored.Id && !t.IsRevoked)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.IsRevoked, true)
                .SetProperty(t => t.RevokedAt, now), cancellationToken);
        if (claimed != 1)
            return AuthErrors.InvalidRefreshToken;

        user.RecordSessionRefresh(now);

        // The client the chain began on, never the one this request names: a phone's token refreshed by a thief
        // pretending to be a browser is still a phone token. Rows from before it was kept read the request.
        var tokens = _tokenIssuer.Issue(user, stored.Client);

        // Link the rotated token so the chain is auditable and a later reuse is recognised as one. The row is
        // already revoked in the database; this writes the same state plus the successor.
        CompositeTokenCodec.TryParse(tokens.RefreshToken, out var newTokenId, out _);
        stored.Revoke(now, newTokenId);

        await _db.SaveChangesAsync(cancellationToken);
        return tokens;
    }
}
