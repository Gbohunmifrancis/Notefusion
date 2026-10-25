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
    DbSet<AdminPhoneKey> AdminPhoneKeys { get; }
    DbSet<AdminTrustedBrowser> AdminTrustedBrowsers { get; }
    DbSet<SupportConversation> SupportConversations { get; }
    DbSet<SupportMessage> SupportMessages { get; }

    /// <summary>Browsers subscribed to web push (the web app's notifications when its tab is closed).</summary>
    DbSet<WebPushSubscription> WebPushSubscriptions { get; }
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
    DbSet<AppEvent> AppEvents { get; }
    DbSet<UserActivity> UserActivities { get; }

    /// <summary>Every transcription asked for, saved or not: what was sent and how it ended; the activity log.</summary>
    DbSet<TranscriptionLog> TranscriptionLogs { get; }

    /// <summary>Feedback messages, ratings and "where did you hear about us?" answers.</summary>
    DbSet<UserFeedback> UserFeedback { get; }

    /// <summary>Public links to a user's folders of saved sheets.</summary>
    DbSet<FolderShare> FolderShares { get; }

    /// <summary>Choirs on the choir plan: the director pays, the members are Pro (see <see cref="Choir"/>).</summary>
    DbSet<Choir> Choirs { get; }

    /// <summary>The singers in each choir; one row per account at most.</summary>
    DbSet<ChoirMember> ChoirMembers { get; }

    // Billing (F-monetization). The immutable ledger is the source of truth for money held; there is
    // no balance column anywhere, so a balance is always summed from LedgerEntries.
    DbSet<Plan> Plans { get; }
    DbSet<PaymentTransaction> PaymentTransactions { get; }

    /// <summary>Checkouts someone came back from unpaid, and what stopped them; one per checkout at most.</summary>
    DbSet<CheckoutExit> CheckoutExits { get; }
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

    /// <summary>Every email the provider accepted, by kind and time: what the sending quota counts (<see cref="EmailBudget"/>).</summary>
    DbSet<EmailSend> EmailSends { get; }

    /// <summary>The blog's posts: the one source of what notefusion.studio/blog shows (see <see cref="BlogPost"/>).</summary>
    DbSet<BlogPost> BlogPosts { get; }

    /// <summary>The queue of topics the Gemini drafter works through.</summary>
    DbSet<BlogTopic> BlogTopics { get; }

    /// <summary>Batches of drafts asked of the Gemini API, with each draft's outcome and tokens.</summary>
    DbSet<BlogGenerationRun> BlogGenerationRuns { get; }

    /// <summary>Requests to rebuild the website after a blog change, and the dispatch that covered them.</summary>
    DbSet<BlogSiteRebuild> BlogSiteRebuilds { get; }

    /// <summary>WebAuthn credentials (passkeys) admins sign in to the console with.</summary>
    DbSet<Passkey> Passkeys { get; }

    /// <summary>Every graded practice (drills and parts); XP, streaks and levels are read off these.</summary>
    DbSet<PracticeSession> PracticeSessions { get; }

    /// <summary>Badges earned, one row per account and badge.</summary>
    DbSet<Achievement> Achievements { get; }

    /// <summary>Practice reminder pushes: the sweep's claim per account, local day and slot, and their audit trail.</summary>
    DbSet<PracticeReminder> PracticeReminders { get; }

    /// <summary>What the backup service did and when (written by the backup container; ops/backup).</summary>
    DbSet<BackupRun> BackupRuns { get; }

    /// <summary>The switches that change what everyone sees (the Christmas season), one row per key.</summary>
    DbSet<FeatureFlag> FeatureFlags { get; }

    /// <summary>The admins' "someone just paid" push: one claim per completed payment, and what became of it.</summary>
    DbSet<AdminPaymentAlert> AdminPaymentAlerts { get; }

    /// <summary>Google Play purchase tokens and the account each belongs to (the Android app's purchases).</summary>
    DbSet<GooglePlayPurchase> GooglePlayPurchases { get; }

    /// <summary>Seasonal Pro offers (Operations › Offers): the price, the dates and the email's words.</summary>
    DbSet<Offer> Offers { get; }

    /// <summary>Each person's queued, sent or skipped copy of an offer's email, and whether its button was clicked.</summary>
    DbSet<OfferEmail> OfferEmails { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
