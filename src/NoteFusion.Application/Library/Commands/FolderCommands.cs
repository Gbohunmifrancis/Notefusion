using System.Security.Cryptography;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>A link token: 128 random bits, URL-safe, the same shape as a sheet's share token.</summary>
internal static class ShareTokens
{
    public static string New()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>Files a saved sheet in a folder ("Sunday choir"), or takes it out of one with a blank name.</summary>
public sealed record UpdateTranscriptionFolderCommand(Guid Id, string? Folder) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionFolderCommandValidator : AbstractValidator<UpdateTranscriptionFolderCommand>
{
    public UpdateTranscriptionFolderCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Folder).MaximumLength(Transcription.FolderMaxLength);
    }
}

public sealed class UpdateTranscriptionFolderCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    : IRequestHandler<UpdateTranscriptionFolderCommand, Result<SavedTranscriptionDto>>
{
    public async Task<Result<SavedTranscriptionDto>> Handle(UpdateTranscriptionFolderCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var item = await db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, ct);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.FileIn(request.Folder);
        await db.SaveChangesAsync(ct);
        return SavedTranscriptionMapper.ToDto(item, includeNotes: false);
    }
}

/// <summary>Renames a folder: every sheet in it moves, and a shared link to it keeps working.</summary>
public sealed record RenameFolderCommand(string From, string To) : IRequest<Result>;

public sealed class RenameFolderCommandValidator : AbstractValidator<RenameFolderCommand>
{
    public RenameFolderCommandValidator()
    {
        RuleFor(x => x.From).NotEmpty().MaximumLength(Transcription.FolderMaxLength);
        RuleFor(x => x.To).NotEmpty().MaximumLength(Transcription.FolderMaxLength);
    }
}

public sealed class RenameFolderCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    : IRequestHandler<RenameFolderCommand, Result>
{
    public async Task<Result> Handle(RenameFolderCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var from = request.From.Trim();
        var to = request.To.Trim();
        var sheets = await db.Transcriptions.Where(t => t.UserId == userId && t.Folder == from).ToListAsync(ct);
        foreach (var sheet in sheets)
            sheet.FileIn(to);

        // One link per folder: renaming onto a folder that already has its own link keeps that one.
        var shares = await db.FolderShares.Where(f => f.UserId == userId && (f.Folder == from || f.Folder == to)).ToListAsync(ct);
        var moving = shares.FirstOrDefault(f => f.Folder == from);
        if (moving is not null)
        {
            if (shares.Any(f => f.Folder == to))
                db.FolderShares.Remove(moving);
            else
                moving.Rename(to);
        }
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/// <summary>
/// One public link for a whole folder. Every sheet in it is shared as well, since the link opens each
/// song as its own shared sheet; sheets filed later are shared when the link is next opened.
/// </summary>
public sealed record ShareFolderCommand(string Folder) : IRequest<Result<ShareLinkDto>>;

public sealed class ShareFolderCommandValidator : AbstractValidator<ShareFolderCommand>
{
    public ShareFolderCommandValidator() => RuleFor(x => x.Folder).NotEmpty().MaximumLength(Transcription.FolderMaxLength);
}

public sealed class ShareFolderCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    : IRequestHandler<ShareFolderCommand, Result<ShareLinkDto>>
{
    public async Task<Result<ShareLinkDto>> Handle(ShareFolderCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var folder = request.Folder.Trim();
        var sheets = await db.Transcriptions.Where(t => t.UserId == userId && t.Folder == folder).ToListAsync(ct);
        if (sheets.Count == 0)
            return LibraryErrors.EmptyFolder;

        var now = clock.UtcNow;
        foreach (var sheet in sheets.Where(s => s.ShareToken is null))
            sheet.Share(ShareTokens.New(), now);

        var share = await db.FolderShares.FirstOrDefaultAsync(f => f.UserId == userId && f.Folder == folder, ct);
        if (share is null)
        {
            share = FolderShare.Create(userId, folder, ShareTokens.New(), now);
            db.FolderShares.Add(share);
        }
        await db.SaveChangesAsync(ct);
        return new ShareLinkDto(share.Token);
    }
}

/// <summary>Stops a folder's link. The sheets keep their own links until each is stopped.</summary>
public sealed record UnshareFolderCommand(string Folder) : IRequest<Result>;

public sealed class UnshareFolderCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    : IRequestHandler<UnshareFolderCommand, Result>
{
    public async Task<Result> Handle(UnshareFolderCommand request, CancellationToken ct)
    {
        if (currentUser.UserId is not { } userId)
            return UserErrors.NotFound;
        var folder = (request.Folder ?? string.Empty).Trim();
        var share = await db.FolderShares.FirstOrDefaultAsync(f => f.UserId == userId && f.Folder == folder, ct);
        if (share is not null)
        {
            db.FolderShares.Remove(share);
            await db.SaveChangesAsync(ct);
        }
        return Result.Success();
    }
}
