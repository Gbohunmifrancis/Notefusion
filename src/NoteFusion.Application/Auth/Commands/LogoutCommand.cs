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
    private readonly IDateTimeProvider _clock;

    public LogoutCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result> Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        if (!CompositeTokenCodec.TryParse(request.RefreshToken, out var tokenId, out _))
            return Result.Success(); // already unusable

        var stored = await _db.RefreshTokens.FirstOrDefaultAsync(t => t.Id == tokenId, cancellationToken);
        if (stored is not null)
        {
            stored.Revoke(_clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return Result.Success();
    }
}
