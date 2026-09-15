using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Infrastructure.Billing.Webhooks;
using NoteFusion.Infrastructure.Billing.Workers;
using Polly;

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
                    client.Timeout = TimeSpan.FromSeconds(30);
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", paystack.SecretKey);
                })
                .AddResilienceHandler("paystack", BuildResiliencePipeline);

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
                    client.Timeout = TimeSpan.FromSeconds(30);
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bachs.SecretKey);
                })
                .AddResilienceHandler("bachs", BuildResiliencePipeline);

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
                    client.Timeout = TimeSpan.FromSeconds(30);
                    client.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", flutterwave.SecretKey);
                })
                .AddResilienceHandler("flutterwave", BuildResiliencePipeline);

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

    /// <summary>
    /// Retry (transient failures only) with the spec's fixed backoff 2s/5s/10s/20s, then a circuit
    /// breaker so a sustained provider outage stops hammering it. Applied to the provider HttpClient,
    /// so gateway code stays about mapping, not resilience.
    /// </summary>
    private static void BuildResiliencePipeline(ResiliencePipelineBuilder<HttpResponseMessage> builder)
    {
        var delays = new[]
        {
            TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(20),
        };

        builder.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = delays.Length,
            // Only 5xx, 408, and network exceptions are retried — a 4xx (e.g. bad request) is not
            // transient and must not be retried. This is the default HttpRetryStrategyOptions predicate.
            DelayGenerator = args => ValueTask.FromResult<TimeSpan?>(
                args.AttemptNumber < delays.Length ? delays[args.AttemptNumber] : delays[^1]),
        });

        builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = 0.5,
            MinimumThroughput = 10,
            SamplingDuration = TimeSpan.FromSeconds(30),
            BreakDuration = TimeSpan.FromSeconds(30),
        });
    }
}
