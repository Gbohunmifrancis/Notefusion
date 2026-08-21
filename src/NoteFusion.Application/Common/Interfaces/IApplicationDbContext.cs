using Microsoft.EntityFrameworkCore;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The persistence contract the Application layer depends on. Implemented by the EF Core DbContext
/// in Infrastructure, keeping handlers free of a concrete provider reference.
/// </summary>
public interface IApplicationDbContext
{
    DbSet<User> Users { get; }
    DbSet<RefreshToken> RefreshTokens { get; }
    DbSet<DeviceToken> DeviceTokens { get; }
    DbSet<Transcription> Transcriptions { get; }

    /// <summary>
    /// One row per submitted ML job. Separate from <see cref="Transcriptions"/> on purpose: a saved
    /// transcription can be deleted, and the free-trial count must not go up when it is.
    /// </summary>
    DbSet<TranscriptionJob> TranscriptionJobs { get; }

    // Billing (F-monetization). The immutable ledger is the source of truth for money held; there is
    // no balance column anywhere, so a balance is always summed from LedgerEntries.
    DbSet<Plan> Plans { get; }
    DbSet<PaymentTransaction> PaymentTransactions { get; }
    DbSet<LedgerEntry> LedgerEntries { get; }
    DbSet<Subscription> Subscriptions { get; }
    DbSet<WebhookEvent> WebhookEvents { get; }

    /// <summary>
    /// Append-only trail of admin actions. Staged by <see cref="IAuditLogger"/> in the same
    /// <see cref="SaveChangesAsync"/> as the change it records, so the two cannot come apart.
    /// </summary>
    DbSet<AdminAuditLog> AdminAuditLogs { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
