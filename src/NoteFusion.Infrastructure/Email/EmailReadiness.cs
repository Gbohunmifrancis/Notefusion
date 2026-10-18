using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// One line at startup saying where mail goes, so a deploy whose key never reached the app is
/// visible in the first screen of logs instead of discovered from a user who got no code.
/// </summary>
public sealed class EmailReadiness : IHostedService
{
    private readonly EmailSettings _settings;
    private readonly EmailQuotaSettings _quota;
    private readonly ILogger<EmailReadiness> _logger;

    public EmailReadiness(EmailSettings settings, EmailQuotaSettings quota, ILogger<EmailReadiness> logger)
    {
        _settings = settings;
        _quota = quota;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_settings.UseResend)
            _logger.LogWarning("Email is logged, not sent: set RESEND_API_KEY to deliver through Resend.");
        else if (string.IsNullOrWhiteSpace(_settings.ApiKey))
            _logger.LogError("Email__UseResend is true but no Resend key was found (Email__ApiKey, Resend__ApiKey or RESEND_API_KEY); every message will be dropped.");
        else if (_settings.FromAddress.EndsWith("@resend.dev", StringComparison.OrdinalIgnoreCase))
            _logger.LogWarning("Email goes through Resend's sandbox sender {From}, which only reaches the key owner's inbox.", _settings.FromAddress);
        else
            _logger.LogInformation("Email is delivered through Resend as {From}.", _settings.FromAddress);

        var windows = EmailBudget.Windows(_quota);
        if (windows.Count == 0)
            _logger.LogInformation("Email quota: no caps set (Email__DailyLimit, Email__WeeklyLimit, Email__MonthlyLimit); optional mail is never held.");
        else
            _logger.LogInformation(
                "Email quota: {Caps}; optional mail is held once a window reaches {Share:P0} of its cap.",
                string.Join(", ", windows.Select(w => $"{w.Limit} per {w.Name}")), _quota.OptionalShare);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
