using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

public sealed record PurgeTestDataResult(
    int UsersDeleted,
    int TranscriptionsDeleted,
    int TranscriptionJobsDeleted,
    int PaymentTransactionsDeleted,
    int SubscriptionsDeleted,
    int LedgerEntriesDeleted,
    int TrialDevicesCleared,
    IReadOnlyList<string> RetainedAdminEmails);

/// <summary>
/// Irreversible pre-production maintenance action. Removes test accounts (Google OAuth and password),
/// test transcriptions, worker jobs, test payments, and trial device fingerprints while retaining
/// designated administrator accounts, seeded billing plans, and audit trails.
/// </summary>
public sealed record PurgeTestDataCommand(string ConfirmationToken, string? Note = null)
    : IRequest<Result<PurgeTestDataResult>>;

public sealed class PurgeTestDataCommandValidator : AbstractValidator<PurgeTestDataCommand>
{
    public PurgeTestDataCommandValidator()
    {
        RuleFor(x => x.ConfirmationToken)
            .Equal("PURGE_TEST_DATA")
            .WithMessage("Confirmation token must be exactly 'PURGE_TEST_DATA'.");
    }
}

public sealed class PurgeTestDataCommandHandler : IRequestHandler<PurgeTestDataCommand, Result<PurgeTestDataResult>>
{
    private static readonly HashSet<string> PreservedAdminEmails = new(StringComparer.OrdinalIgnoreCase)
    {
        "hello@notefusion.studio",
        "francisgbohunmi@gmail.com",
        "admin@notefusion.app"
    };

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public PurgeTestDataCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result<PurgeTestDataResult>> Handle(PurgeTestDataCommand request, CancellationToken ct)
    {
        // Safety guard: ensure the caller is an authenticated administrator
        if (_currentUser.Role != UserRole.Admin)
            return Result.Failure<PurgeTestDataResult>(Error.Forbidden("Admin.Forbidden", "Only administrators can execute test data purge."));

        // 1. Identify users to delete vs retain
        var allUsers = await _db.Users.ToListAsync(ct);
        var usersToDelete = allUsers
            .Where(u => u.Role != UserRole.Admin && !PreservedAdminEmails.Contains(u.Email))
            .ToList();

        var retainedAdmins = allUsers
            .Where(u => u.Role == UserRole.Admin || PreservedAdminEmails.Contains(u.Email))
            .Select(u => u.Email)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // 2. Clear all test transcriptions and jobs
        var transcriptions = await _db.Transcriptions.ToListAsync(ct);
        var jobs = await _db.TranscriptionJobs.ToListAsync(ct);

        _db.Transcriptions.RemoveRange(transcriptions);
        _db.TranscriptionJobs.RemoveRange(jobs);

        // 3. Clear all test billing records (payments, subscriptions, ledger)
        var payments = await _db.PaymentTransactions.ToListAsync(ct);
        var subscriptions = await _db.Subscriptions.ToListAsync(ct);
        var ledgerEntries = await _db.LedgerEntries.ToListAsync(ct);

        _db.PaymentTransactions.RemoveRange(payments);
        _db.Subscriptions.RemoveRange(subscriptions);
        _db.LedgerEntries.RemoveRange(ledgerEntries);

        // 4. Clear trial device fingerprints so production devices have clean quotas
        var trialDevices = await _db.TrialDevices.ToListAsync(ct);
        _db.TrialDevices.RemoveRange(trialDevices);

        // 5. Delete non-admin users (RefreshTokens & DeviceTokens cascade automatically)
        _db.Users.RemoveRange(usersToDelete);

        // 6. Record in audit trail
        _audit.Record(
            AdminAuditAction.PurgeTestData,
            null,
            $"Pre-production purge completed: {usersToDelete.Count} user(s), {transcriptions.Count} transcription(s), {jobs.Count} job(s), {payments.Count} payment(s) removed.",
            request.Note);

        await _db.SaveChangesAsync(ct);

        var result = new PurgeTestDataResult(
            UsersDeleted: usersToDelete.Count,
            TranscriptionsDeleted: transcriptions.Count,
            TranscriptionJobsDeleted: jobs.Count,
            PaymentTransactionsDeleted: payments.Count,
            SubscriptionsDeleted: subscriptions.Count,
            LedgerEntriesDeleted: ledgerEntries.Count,
            TrialDevicesCleared: trialDevices.Count,
            RetainedAdminEmails: retainedAdmins);

        return Result.Success(result);
    }
}
