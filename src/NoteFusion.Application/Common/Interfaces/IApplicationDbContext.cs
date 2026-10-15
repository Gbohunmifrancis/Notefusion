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

    /// <summary>
    /// One row per handset that has spent a free generation, with where it was first seen. The ceiling is
    /// enforced from the device stamp on <see cref="TranscriptionJobs"/>; this is the register that makes
    /// multi-account farming visible rather than merely blocked.
    /// </summary>
    DbSet<TrialDevice> TrialDevices { get; }

    /// <summary>Anonymous try-it-free transcriptions from the website; the web funnel's top.</summary>
    DbSet<PreviewJob> PreviewJobs { get; }

    /// <summary>Page views, clicks and app actions from the website; the dashboard's web traffic.</summary>
    DbSet<WebEvent> WebEvents { get; }

    /// <summary>Every transcription asked for, saved or not: what was sent and how it ended; the activity log.</summary>
    DbSet<TranscriptionLog> TranscriptionLogs { get; }

    /// <summary>Feedback messages, ratings and "where did you hear about us?" answers.</summary>
    DbSet<UserFeedback> UserFeedback { get; }

    /// <summary>Public links to a user's folders of saved sheets.</summary>
    DbSet<FolderShare> FolderShares { get; }

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

    /// <summary>Subscribers who joined the early access waitlist.</summary>
    DbSet<WaitlistEntry> WaitlistEntries { get; }

    /// <summary>Global system announcement banner.</summary>
    DbSet<SystemAnnouncement> SystemAnnouncements { get; }

    /// <summary>Every customer-research message sent (or tried); the outreach sweep's claim and audit trail.</summary>
    DbSet<OutreachMessage> OutreachMessages { get; }

    /// <summary>Accounts that unsubscribed from non-essential email.</summary>
    DbSet<EmailOptOut> EmailOptOuts { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
