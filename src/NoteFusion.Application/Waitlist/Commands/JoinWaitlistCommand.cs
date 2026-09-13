using System.Text.RegularExpressions;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Waitlist.Commands;

public sealed record WaitlistEntryDto(
    Guid Id,
    string Email,
    string? FullName,
    string? Role,
    DateTime CreatedAtUtc);

public sealed record JoinWaitlistCommand(
    string Email,
    string? FullName = null,
    string? Role = null,
    string? Source = null) : IRequest<Result<WaitlistEntryDto>>;

public sealed class JoinWaitlistCommandHandler : IRequestHandler<JoinWaitlistCommand, Result<WaitlistEntryDto>>
{
    private static readonly Regex EmailRegex = new(
        @"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly IApplicationDbContext _db;
    private readonly IEmailSender _emailSender;

    public JoinWaitlistCommandHandler(IApplicationDbContext db, IEmailSender emailSender)
    {
        _db = db;
        _emailSender = emailSender;
    }

    public async Task<Result<WaitlistEntryDto>> Handle(
        JoinWaitlistCommand request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || !EmailRegex.IsMatch(request.Email.Trim()))
        {
            return Result.Failure<WaitlistEntryDto>(WaitlistErrors.InvalidEmail);
        }

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();

        var exists = await _db.WaitlistEntries
            .AnyAsync(w => w.Email == normalizedEmail, ct);

        if (exists)
        {
            return Result.Failure<WaitlistEntryDto>(WaitlistErrors.AlreadyRegistered);
        }

        var entry = new WaitlistEntry(
            Guid.NewGuid(),
            normalizedEmail,
            request.FullName,
            request.Role,
            request.Source);

        _db.WaitlistEntries.Add(entry);
        await _db.SaveChangesAsync(ct);

        // Deliver branded confirmation email (non-blocking best-effort by contract)
        await _emailSender.SendWaitlistConfirmationAsync(
            new EmailRecipient(entry.Email, entry.FullName), ct);

        return Result.Success(new WaitlistEntryDto(
            entry.Id,
            entry.Email,
            entry.FullName,
            entry.Role,
            entry.CreatedAtUtc));
    }
}
