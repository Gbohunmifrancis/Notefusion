using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Infrastructure.Billing.Webhooks;
using NoteFusion.Infrastructure.Billing.Workers;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Wires the billing/payments module: settings, provider gateways (Paystack and Bachs live, the others
/// stubbed until credentialed), webhook validators, the gateway factory, plan seeding, and the two
/// background workers. Every provider is registered so the factory treats them uniformly; only a provider
/// whose credentials are fully present gets a live adapter, and each live one gets its own NAMED
/// HttpClient so their base URLs and bearer tokens cannot cross.
/// </summary>
public static class BillingDependencyInjection
{
    public static IServiceCollection AddBilling(this IServiceCollection services, IConfiguration configuration)
    {
        var settings = configuration.GetSection("Billing").Get<BillingSettings>() ?? new BillingSettings();
        services.AddSingleton(settings);

        var paystack = configuration.GetSection("Paystack").Get<PaymentProviderOptions>() ?? new PaymentProviderOptions();

        // Paystack — the reference adapter. Only wire the live HTTP client when it's configured;
        // otherwise it joins the stubbed providers so an unconfigured deployment can't half-charge.
        if (paystack.IsConfigured)
        {
            services.AddSingleton(paystack);

            // Named explicitly. The typed-client overload without a name derives it from TClient, which
            // is IPaymentGateway for every provider — so two gateways registered that way would share one
            // HttpClient configuration and the later registration would silently redirect the earlier
            // provider's traffic to its own base URL, with its own bearer token.
            services.AddHttpClient<IPaymentGateway, PaystackPaymentGateway>("paystack", client =>
                {
                    client.BaseAddress = new Uri(paystack.BaseUrl.TrimEnd('/'));
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", paystack.SecretKey);
                })
                .AddOutboundResilience(OutboundResilience.Payment(PaymentProvider.Paystack));

            services.AddSingleton<IPaymentWebhookValidator>(new PaystackWebhookValidator(paystack));
        }
        else
        {
            services.AddSingleton<IPaymentGateway>(
                new StubPaymentGateway(PaymentProvider.Paystack, paystack.Currencies));
            services.AddSingleton<IPaymentWebhookValidator>(new StubWebhookValidator(PaymentProvider.Paystack));
        }

        // Bachs — its own options type, because its webhook signing secret is a separate per-endpoint
        // credential (not the API key) and its plans map to catalog product ids. See BachsOptions.
        var bachs = configuration.GetSection("Bachs").Get<BachsOptions>() ?? new BachsOptions();

        if (bachs.IsConfigured)
        {
            services.AddSingleton(bachs);
            services.AddHttpClient<IPaymentGateway, BachsPaymentGateway>("bachs", client =>
                {
                    client.BaseAddress = new Uri(bachs.BaseUrl.TrimEnd('/'));
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bachs.SecretKey);
                })
                .AddOutboundResilience(OutboundResilience.Payment(PaymentProvider.Bachs));

            // Resolved from the container rather than constructed here: the validator needs the clock for
            // its replay window, and the clock is registered by the persistence/common module.
            services.AddSingleton<IPaymentWebhookValidator>(sp => new BachsWebhookValidator(
                bachs, sp.GetRequiredService<IDateTimeProvider>()));
        }
        else
        {
            services.AddSingleton<IPaymentGateway>(
                new StubPaymentGateway(PaymentProvider.Bachs, bachs.Currencies));
            services.AddSingleton<IPaymentWebhookValidator>(new StubWebhookValidator(PaymentProvider.Bachs));
        }

        // Flutterwave — integrated standard hosted checkout and verification
        var flutterwave = configuration.GetSection("Flutterwave").Get<PaymentProviderOptions>() ?? new PaymentProviderOptions();

        if (flutterwave.IsConfigured)
        {
            services.AddSingleton(flutterwave);
            services.AddHttpClient<IPaymentGateway, FlutterwavePaymentGateway>("flutterwave", client =>
                {
                    client.BaseAddress = new Uri(flutterwave.BaseUrl.TrimEnd('/'));
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", flutterwave.SecretKey);
                })
                .AddOutboundResilience(OutboundResilience.Payment(PaymentProvider.Flutterwave));

            services.AddSingleton<IPaymentWebhookValidator>(new FlutterwaveWebhookValidator(flutterwave));
        }
        else
        {
            services.AddSingleton<IPaymentGateway>(
                new StubPaymentGateway(PaymentProvider.Flutterwave, flutterwave.Currencies));
            services.AddSingleton<IPaymentWebhookValidator>(new StubWebhookValidator(PaymentProvider.Flutterwave));
        }

        // Squad is listed in the product plan but not yet integrated. Registers
        // as stub so the factory and webhook routing are uniform; fails fast until credentialed.
        RegisterStub(services, configuration, PaymentProvider.Squad, "Squad");

        services.AddSingleton<IPaymentGatewayFactory, PaymentGatewayFactory>();

        services.AddHostedService<BillingSeeder>();
        services.AddHostedService<PaymentWebhookWorker>();
        services.AddHostedService<PaymentReconciliationWorker>();
        services.AddHostedService<SubscriptionExpiryWorker>();
        services.AddHostedService<AdminPaymentAlertWorker>();
        services.AddHostedService<PaymentAlertWorker>();
        services.AddHostedService<StalePaymentCleanupWorker>();

        return services;
    }

    private static void RegisterStub(
        IServiceCollection services, IConfiguration configuration, PaymentProvider provider, string section)
    {
        var options = configuration.GetSection(section).Get<PaymentProviderOptions>() ?? new PaymentProviderOptions();
        services.AddSingleton<IPaymentGateway>(new StubPaymentGateway(provider, options.Currencies));
        services.AddSingleton<IPaymentWebhookValidator>(new StubWebhookValidator(provider));
    }
}
