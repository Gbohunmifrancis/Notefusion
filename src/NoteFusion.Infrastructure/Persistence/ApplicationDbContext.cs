using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// EF Core context backing <see cref="IApplicationDbContext"/>. Entity configurations live in
/// <c>Persistence/Configurations</c> and are applied from this assembly. PostgreSQL via Npgsql.
/// </summary>
public sealed class ApplicationDbContext : DbContext, IApplicationDbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<DeviceToken> DeviceTokens => Set<DeviceToken>();
    public DbSet<WebPushSubscription> WebPushSubscriptions => Set<WebPushSubscription>();
    public DbSet<Transcription> Transcriptions => Set<Transcription>();
    public DbSet<TranscriptionJob> TranscriptionJobs => Set<TranscriptionJob>();
    public DbSet<TrialDevice> TrialDevices => Set<TrialDevice>();
    public DbSet<PreviewJob> PreviewJobs => Set<PreviewJob>();
    public DbSet<WebEvent> WebEvents => Set<WebEvent>();
    public DbSet<TranscriptionLog> TranscriptionLogs => Set<TranscriptionLog>();
    public DbSet<UserFeedback> UserFeedback => Set<UserFeedback>();
    public DbSet<FolderShare> FolderShares => Set<FolderShare>();
    public DbSet<Choir> Choirs => Set<Choir>();
    public DbSet<ChoirMember> ChoirMembers => Set<ChoirMember>();

    public DbSet<Plan> Plans => Set<Plan>();
    public DbSet<PaymentTransaction> PaymentTransactions => Set<PaymentTransaction>();
    public DbSet<LedgerEntry> LedgerEntries => Set<LedgerEntry>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<WebhookEvent> WebhookEvents => Set<WebhookEvent>();

    public DbSet<AdminAuditLog> AdminAuditLogs => Set<AdminAuditLog>();
    public DbSet<WaitlistEntry> WaitlistEntries => Set<WaitlistEntry>();
    public DbSet<SystemAnnouncement> SystemAnnouncements => Set<SystemAnnouncement>();

    public DbSet<OutreachMessage> OutreachMessages => Set<OutreachMessage>();
    public DbSet<EmailOptOut> EmailOptOuts => Set<EmailOptOut>();

    public DbSet<BlogPost> BlogPosts => Set<BlogPost>();
    public DbSet<BlogTopic> BlogTopics => Set<BlogTopic>();
    public DbSet<BlogGenerationRun> BlogGenerationRuns => Set<BlogGenerationRun>();
    public DbSet<BlogSiteRebuild> BlogSiteRebuilds => Set<BlogSiteRebuild>();

    public DbSet<Passkey> Passkeys => Set<Passkey>();

    public DbSet<PracticeSession> PracticeSessions => Set<PracticeSession>();
    public DbSet<Achievement> Achievements => Set<Achievement>();
    public DbSet<BackupRun> BackupRuns => Set<BackupRun>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ApplicationDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
