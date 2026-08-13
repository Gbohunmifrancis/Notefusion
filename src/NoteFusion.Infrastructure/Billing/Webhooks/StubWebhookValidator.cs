using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Billing.Webhooks;

/// <summary>
/// Webhook validator for a not-yet-credentialed provider. It rejects every request as unauthorized,
/// so an un-wired provider can never have a webhook accepted. Replace with a real validator (mirroring
/// <see cref="PaystackWebhookValidator"/>) when that provider is integrated.
/// </summary>
internal sealed class StubWebhookValidator : IPaymentWebhookValidator
{
    public StubWebhookValidator(PaymentProvider provider) => Provider = provider;

    public PaymentProvider Provider { get; }

    public Result<WebhookMessage> Validate(WebhookRequest request)
        => Error.Unauthorized("Webhook.Unconfigured", $"The {Provider} webhook is not configured.");
}
