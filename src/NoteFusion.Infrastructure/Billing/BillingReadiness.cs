using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing.Gateways;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Whether every plan on sale can actually be paid for with the providers this deployment has
/// configured. The billing model is one rule — naira plans are Paystack subscriptions, dollar plans
/// are Bachs subscriptions against catalog products — and each half can silently come apart in
/// config alone: a provider missing its base URL boots as a stub, and a Bachs plan whose code has no
/// product mapped fails at the first checkout. Run at startup and logged, so a broken paywall is a
/// log line at deploy time rather than a support ticket a week later.
/// </summary>
public static class BillingReadiness
{
    /// <summary>One line per problem; empty when every active plan has a live route to a provider.</summary>
    public static IReadOnlyList<string> Check(
        IEnumerable<Plan> activePlans, IPaymentGatewayFactory gateways, BachsOptions? bachs)
    {
        var problems = new List<string>();
        foreach (var plan in activePlans.Where(p => p.IsActive))
        {
            var selected = gateways.SelectForCurrency(plan.Currency);
            if (selected.IsFailure)
            {
                problems.Add($"Plan {plan.Code} ({plan.Currency}): no provider lists {plan.Currency} in its SupportedCurrencies.");
                continue;
            }

            var gateway = selected.Value;
            if (gateway is StubPaymentGateway)
            {
                problems.Add(
                    $"Plan {plan.Code} ({plan.Currency}): routed to {gateway.Provider}, which is not configured "
                    + $"(set {gateway.Provider}__SecretKey and {gateway.Provider}__BaseUrl{(gateway.Provider == PaymentProvider.Bachs ? " and Bachs__WebhookSecret" : "")}).");
                continue;
            }

            // No catalog product is needed: every checkout is a one-off priced from the plan row.
        }

        // A configured Bachs whose key and host belong to different environments is as good as a stub.
        if (bachs?.EnvironmentMismatch is { } mismatch)
            problems.Add(mismatch);

        return problems;
    }

    /// <summary>
    /// A warning when the checkout return URL is not the API's own https return page, or null when it is.
    /// The providers send the paying customer's browser there, so a wrong host strands them on a dead
    /// page after paying, a non-https one is refused outright, and a different path loses the website's
    /// <c>/web</c> variant (only the API's own return page can be extended with it).
    /// </summary>
    public static string? CheckCallbackUrl(string callbackUrl)
    {
        if (!Uri.TryCreate(callbackUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return $"Billing__CheckoutCallbackUrl '{callbackUrl}' is not an absolute https URL; hosted checkouts will refuse it.";

        if (!uri.AbsolutePath.TrimEnd('/').EndsWith("/api/billing/return", StringComparison.OrdinalIgnoreCase))
        {
            return $"Billing__CheckoutCallbackUrl '{callbackUrl}' does not end in /api/billing/return; "
                + "checkouts will not return to the app, and website checkouts cannot return to the site.";
        }

        return null;
    }
}
