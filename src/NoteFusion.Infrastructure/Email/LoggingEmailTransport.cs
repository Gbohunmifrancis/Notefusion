using Microsoft.Extensions.Logging;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Default <see cref="IEmailTransport"/> used in development: writes the message to the log instead of
/// sending it. Mirrors <c>LoggingPushSender</c> — a local run needs no API key, and cannot mail a real
/// person by accident while someone is testing sign-up with their own address.
/// </summary>
public sealed class LoggingEmailTransport : IEmailTransport
{
    private readonly ILogger<LoggingEmailTransport> _logger;

    public LoggingEmailTransport(ILogger<LoggingEmailTransport> logger) => _logger = logger;

    public Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        // The text part, not the HTML: it carries the same facts and is readable in a console.
        _logger.LogInformation(
            "[email] to {Recipient} · {Subject}\n{Body}",
            message.ToEmail, message.Subject, message.TextBody);

        return Task.CompletedTask;
    }
}
