using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common;

/// <summary>
/// What the console counts: customers only. Admins and accounts flagged internal
/// (<see cref="User.IsInternal"/>) are the team testing the product, and every analytics figure, chart,
/// leaderboard and account list reads through these instead of the raw sets, so a test transcription,
/// a gifted Pro or an admin browsing the site never shows up as a customer.
/// </summary>
/// <remarks>
/// Each returns an <see cref="IQueryable{T}"/> filtered by a subquery (<c>NOT IN</c> the internal ids), so
/// nothing is loaded and it composes with whatever the caller adds. Anonymous web traffic carries no
/// account, so a browser counts as internal once any of its events was made while signed in as an
/// internal account: the team's own visits to the website and previews stay out too.
/// </remarks>
public static class AnalyticsScope
{
    public static IQueryable<Guid> InternalUserIds(this IApplicationDbContext db)
        => db.Users.Where(u => u.Role == UserRole.Admin || u.IsInternal).Select(u => u.Id);

    public static IQueryable<User> RealUsers(this IApplicationDbContext db)
        => db.Users.Where(u => u.Role != UserRole.Admin && !u.IsInternal);

    public static IQueryable<TranscriptionJob> RealJobs(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.TranscriptionJobs.Where(j => !internalIds.Contains(j.UserId));
    }

    public static IQueryable<Transcription> RealSheets(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.Transcriptions.Where(t => !internalIds.Contains(t.UserId));
    }

    public static IQueryable<Subscription> RealSubscriptions(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.Subscriptions.Where(s => !internalIds.Contains(s.UserId));
    }

    /// <summary>Choirs whose director is a customer.</summary>
    public static IQueryable<Choir> RealChoirs(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.Choirs.Where(c => !internalIds.Contains(c.OwnerId));
    }

    public static IQueryable<PaymentTransaction> RealPayments(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.PaymentTransactions.Where(p => !internalIds.Contains(p.UserId));
    }

    public static IQueryable<LedgerEntry> RealLedger(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.LedgerEntries.Where(e => !internalIds.Contains(e.UserId));
    }

    public static IQueryable<UserFeedback> RealFeedback(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.UserFeedback.Where(f => !internalIds.Contains(f.UserId));
    }

    public static IQueryable<DeviceToken> RealDeviceTokens(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.DeviceTokens.Where(d => !internalIds.Contains(d.UserId));
    }

    public static IQueryable<TranscriptionLog> RealLogs(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.TranscriptionLogs.Where(l => l.UserId == null || !internalIds.Contains(l.UserId.Value));
    }

    public static IQueryable<PracticeSession> RealPracticeSessions(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.PracticeSessions.Where(s => !internalIds.Contains(s.UserId));
    }

    public static IQueryable<Achievement> RealAchievements(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.Achievements.Where(a => !internalIds.Contains(a.UserId));
    }

    public static IQueryable<PracticeReminder> RealPracticeReminders(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.PracticeReminders.Where(r => !internalIds.Contains(r.UserId));
    }

    /// <summary>Browsers that were ever signed in as an internal account.</summary>
    public static IQueryable<string> InternalVisitors(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.WebEvents.Where(e => e.UserId != null && internalIds.Contains(e.UserId.Value)).Select(e => e.VisitorId);
    }

    public static IQueryable<WebEvent> RealWebEvents(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        var internalVisitors = db.InternalVisitors();
        return db.WebEvents.Where(e => !(e.UserId != null && internalIds.Contains(e.UserId.Value))
                                       && !internalVisitors.Contains(e.VisitorId));
    }

    /// <summary>Previews not claimed by an internal account.</summary>
    public static IQueryable<PreviewJob> RealPreviews(this IApplicationDbContext db)
    {
        var internalIds = db.InternalUserIds();
        return db.PreviewJobs.Where(p => p.ClaimedByUserId == null || !internalIds.Contains(p.ClaimedByUserId.Value));
    }
}
