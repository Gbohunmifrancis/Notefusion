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
/// Wires the billing/payments module: settings, provider gateways (Paystack live, others stubbed until
/// credentialed), webhook validators, the gateway factory, plan seeding, and the two background
/// workers. Every provider is registered so the factory treats them uniformly; only a provider with a
/// configured secret gets a live adapter.
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
            services.AddHttpClient<IPaymentGateway, PaystackPaymentGateway>(client =>
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

        // The remaining providers are listed in the product plan but not yet integrated. They register
        // as stubs so the factory and webhook routing are uniform; each fails fast until credentialed.
        RegisterStub(services, configuration, PaymentProvider.Flutterwave, "Flutterwave");
        RegisterStub(services, configuration, PaymentProvider.Squad, "Squad");
        RegisterStub(services, configuration, PaymentProvider.Bachs, "Bachs");

        services.AddSingleton<IPaymentGatewayFactory, PaymentGatewayFactory>();

        services.AddHostedService<BillingSeeder>();
        services.AddHostedService<PaymentWebhookWorker>();
        services.AddHostedService<PaymentReconciliationWorker>();

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
