using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// <see cref="IEmailQuota"/> over the <c>email_sends</c> rows: one COUNT per capped window, against
/// <see cref="EmailBudget"/>'s rules.
/// </summary>
/// <remarks>
/// A send is recorded on a context of its own, not the request's: saving the request's context would also save
/// whatever the caller had staged and not yet committed.
/// </remarks>
public sealed class EmailQuota : IEmailQuota
{
    private readonly ApplicationDbContext _db;
    private readonly DbContextOptions<ApplicationDbContext> _options;
    private readonly EmailQuotaSettings _settings;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<EmailQuota> _logger;

    public EmailQuota(
        ApplicationDbContext db,
        DbContextOptions<ApplicationDbContext> options,
        EmailQuotaSettings settings,
        IDateTimeProvider clock,
        ILogger<EmailQuota> logger)
    {
        _db = db;
        _options = options;
        _settings = settings;
        _clock = clock;
        _logger = logger;
    }

    public async Task<bool> AllowsOptionalAsync(EmailKind kind, CancellationToken ct)
    {
        try
        {
            var now = _clock.UtcNow;
            foreach (var window in EmailBudget.Windows(_settings))
            {
                var sent = await CountAsync(window, now, ct);
                if (EmailBudget.AllowsOptional(sent, window.Limit, _settings.OptionalShare))
                    continue;

                _logger.LogInformation(
                    "Optional email held back: {EmailKind}, {EmailWindow} window at {EmailsSent}/{EmailLimit} (optional mail stops at {OptionalCeiling}).",
                    kind, window.Name, sent, window.Limit, EmailBudget.OptionalCeiling(window.Limit, _settings.OptionalShare));
                return false;
            }
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Unknown usage: the optional email waits rather than risk the essential mail's room.
            _logger.LogWarning(ex, "Could not read the email quota; holding back optional {EmailKind} mail.", kind);
            return false;
        }
    }

    public async Task RecordSentAsync(EmailKind kind)
    {
        try
        {
            await using var db = new ApplicationDbContext(_options);
            db.EmailSends.Add(EmailSend.Record(kind, _clock.UtcNow));
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not record a sent {EmailKind} email; the quota will count one fewer.", kind);
        }
    }

    public async Task<IReadOnlyList<EmailWindowUsage>> ReadUsageAsync(CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var usage = new List<EmailWindowUsage>();
        foreach (var window in EmailBudget.Windows(_settings))
        {
            usage.Add(new EmailWindowUsage(
                window.Name,
                await CountAsync(window, now, ct),
                window.Limit,
                EmailBudget.OptionalCeiling(window.Limit, _settings.OptionalShare)));
        }
        return usage;
    }

    /// <summary>Sends in the window: after <c>now - length</c>, so one sent exactly a window ago has left it.</summary>
    private Task<int> CountAsync(EmailWindow window, DateTime now, CancellationToken ct)
    {
        var after = now - window.Length;
        return _db.EmailSends.CountAsync(s => s.SentAtUtc > after, ct);
    }
}
