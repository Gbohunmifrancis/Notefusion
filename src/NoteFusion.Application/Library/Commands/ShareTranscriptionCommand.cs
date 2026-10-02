using System.Security.Cryptography;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Puts a saved sheet behind a public link. Idempotent: sharing twice returns the same token, so
/// a link already pasted into a choir group keeps working.
/// </summary>
public sealed record ShareTranscriptionCommand(Guid Id) : IRequest<Result<ShareLinkDto>>;

public sealed class ShareTranscriptionCommandHandler : IRequestHandler<ShareTranscriptionCommand, Result<ShareLinkDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public ShareTranscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<ShareLinkDto>> Handle(ShareTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        if (item.ShareToken is null)
        {
            item.Share(NewToken(), _clock.UtcNow);
            await _db.SaveChangesAsync(cancellationToken);
        }
        return new ShareLinkDto(item.ShareToken!);
    }

    /// <summary>128 bits, URL-safe, no padding — unguessable and short enough to paste.</summary>
    private static string NewToken()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>Takes a sheet back off its public link.</summary>
public sealed record UnshareTranscriptionCommand(Guid Id) : IRequest<Result>;

public sealed class UnshareTranscriptionCommandHandler : IRequestHandler<UnshareTranscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UnshareTranscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result> Handle(UnshareTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.Unshare();
        await _db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }
}
