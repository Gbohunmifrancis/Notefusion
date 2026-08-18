using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Billing.Gateways;
using NoteFusion.Infrastructure.Billing.Webhooks;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Container-level tests for <see cref="BillingDependencyInjection.AddBilling"/>, now that two providers
/// are live at once.
/// <para>
/// The failure this file exists to catch is silent and expensive: the typed-client overload without an
/// explicit name derives the HttpClient name from <c>TClient</c>, which is <c>IPaymentGateway</c> for
/// every provider — so two gateways registered that way would share one configuration, and the later
/// registration would send the earlier provider's traffic to its own host with its own bearer token. A
/// unit test of either adapter passes happily while that is true. Only driving a request through the
/// assembled container shows it, so these tests attach a recording handler to each named client and check
/// where the bytes actually went.
/// </para>
/// <para>
/// The same applies to the options objects and the webhook validators: one <c>PaymentProviderOptions</c>
/// singleton shared by two providers, or a validator that fell back to the API key as its HMAC secret,
/// would both compile and both be catastrophic.
/// </para>
/// </summary>
public class BillingWiringTests
{
    private const string BachsHost = "api.bachs.io";
    private const string PaystackHost = "api.paystack.co";

    private static Dictionary<string, string?> Config(string defaultProvider = "Bachs") => new()
    {
        ["Billing:DefaultProvider"] = defaultProvider,

        ["Paystack:SecretKey"] = "sk_live_paystack",
        ["Paystack:BaseUrl"] = $"https://{PaystackHost}",
        ["Paystack:SupportedCurrencies"] = "USD,NGN",

        ["Bachs:SecretKey"] = "sk_live_bachs",
        ["Bachs:BaseUrl"] = $"https://{BachsHost}",
        ["Bachs:WebhookSecret"] = "whsec_bachs",
        ["Bachs:SupportedCurrencies"] = "USD",
        ["Bachs:ProductMap:pro_monthly"] = "prod_month",
    };

    private static ServiceProvider Build(
        Dictionary<string, string?> config,
        Action<IServiceCollection>? extra = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(config).Build();

        var services = new ServiceCollection();
        services.AddSingleton<IDateTimeProvider>(new FixedClock(new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)));
        services.AddBilling(configuration);
        extra?.Invoke(services);

        return services.BuildServiceProvider();
    }

    private static GatewayInitiationRequest Initiation() => new(
        "NF_wiring", 499, "USD", "jane@example.com", "notefusion://billing/return",
        Recurring: true, IdempotencyKey: "checkout:NF_wiring", "pro_monthly", "Jane Doe");

    // ---------------------------------------------------------------- adapters

    [Fact]
    public void Each_provider_resolves_to_its_own_adapter()
    {
        using var provider = Build(Config());
        var factory = provider.GetRequiredService<IPaymentGatewayFactory>();

        Assert.IsType<BachsPaymentGateway>(factory.Resolve(PaymentProvider.Bachs));
        Assert.IsType<PaystackPaymentGateway>(factory.Resolve(PaymentProvider.Paystack));

        // Not yet integrated, and a stub that fails fast is the honest representation of that.
        Assert.IsType<StubPaymentGateway>(factory.Resolve(PaymentProvider.Flutterwave));
        Assert.IsType<StubPaymentGateway>(factory.Resolve(PaymentProvider.Squad));
    }

    [Fact]
    public async Task Each_live_gateway_reaches_its_own_host_with_its_own_key()
    {
        var bachs = StubHttpMessageHandler.Returning(
            System.Net.HttpStatusCode.Created,
            """{"checkout_id":"chk_1","checkout_url":"https://checkout.bachs.io/c/chk_1","status":"open"}""");
        var paystack = StubHttpMessageHandler.Returning(
            System.Net.HttpStatusCode.OK,
            """{"status":true,"data":{"authorization_url":"https://checkout.paystack.com/x"}}""");

        using var provider = Build(Config(), services =>
        {
            // Additive on the named clients AddBilling registered, so the base address and bearer token
            // under test are the real ones — only the socket is replaced.
            services.AddHttpClient("bachs").ConfigurePrimaryHttpMessageHandler(() => bachs);
            services.AddHttpClient("paystack").ConfigurePrimaryHttpMessageHandler(() => paystack);
        });
        var factory = provider.GetRequiredService<IPaymentGatewayFactory>();

        var bachsResult = await factory.Resolve(PaymentProvider.Bachs)
            .InitiateAsync(Initiation(), CancellationToken.None);
        var paystackResult = await factory.Resolve(PaymentProvider.Paystack)
            .InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(bachsResult.IsSuccess);
        Assert.True(paystackResult.IsSuccess);

        var bachsRequest = Assert.Single(bachs.Requests);
        Assert.Equal(BachsHost, bachsRequest.Uri!.Host);
        Assert.Equal("/v1/checkout-sessions", bachsRequest.Uri.AbsolutePath);
        Assert.Equal("Bearer sk_live_bachs", bachsRequest.Headers["Authorization"]);

        var paystackRequest = Assert.Single(paystack.Requests);
        Assert.Equal(PaystackHost, paystackRequest.Uri!.Host);
        Assert.Equal("/transaction/initialize", paystackRequest.Uri.AbsolutePath);
        Assert.Equal("Bearer sk_live_paystack", paystackRequest.Headers["Authorization"]);
    }

    [Fact]
    public async Task Each_live_gateway_uses_its_own_options()
    {
        // Two singletons of one options type would hand whichever adapter resolved second the other's
        // credentials and currencies. Bachs' plan→product map is the cheapest observable proof that its
        // adapter is reading the Bachs section: with the wrong options object the map would be empty and
        // the plan would come back unmapped.
        var handler = StubHttpMessageHandler.Returning(
            System.Net.HttpStatusCode.Created,
            """{"checkout_id":"chk_1","checkout_url":"https://checkout.bachs.io/c/chk_1","status":"open"}""");

        using var provider = Build(
            Config(), services => services.AddHttpClient("bachs").ConfigurePrimaryHttpMessageHandler(() => handler));
        var factory = provider.GetRequiredService<IPaymentGatewayFactory>();

        var result = await factory.Resolve(PaymentProvider.Bachs).InitiateAsync(Initiation(), CancellationToken.None);

        Assert.True(result.IsSuccess);
        using var body = System.Text.Json.JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        Assert.Equal(
            "prod_month",
            body.RootElement.GetProperty("product_cart")[0].GetProperty("product_id").GetString());

        Assert.Equal(new[] { "USD" }, factory.Resolve(PaymentProvider.Bachs).SupportedCurrencies);
        Assert.Equal(new[] { "USD", "NGN" }, factory.Resolve(PaymentProvider.Paystack).SupportedCurrencies);
    }

    // ---------------------------------------------------------------- validators

    [Fact]
    public void Each_provider_resolves_to_its_own_webhook_validator()
    {
        using var provider = Build(Config());
        var validators = provider.GetRequiredService<IEnumerable<IPaymentWebhookValidator>>()
            .ToDictionary(v => v.Provider);

        Assert.IsType<BachsWebhookValidator>(validators[PaymentProvider.Bachs]);
        Assert.IsType<PaystackWebhookValidator>(validators[PaymentProvider.Paystack]);
        Assert.IsType<StubWebhookValidator>(validators[PaymentProvider.Squad]);

        // The controller keys on Provider, so a duplicate would throw on the first webhook of any kind.
        Assert.Equal(4, validators.Count);
    }

    [Fact]
    public void The_bachs_validator_verifies_with_the_signing_secret_not_the_api_key()
    {
        // If EffectiveWebhookSecret-style fallback ever crept in, this delivery — signed with the
        // configured whsec_ value — would still verify, so the test is paired with the one below.
        using var provider = Build(Config());
        var validator = provider.GetRequiredService<IEnumerable<IPaymentWebhookValidator>>()
            .Single(v => v.Provider == PaymentProvider.Bachs);

        const string body = """{"id":"evt_1","type":"collection.succeeded","data":{"reference":"NF_abc"}}""";

        Assert.True(validator.Validate(Signed(body, "whsec_bachs")).IsSuccess);
        Assert.True(validator.Validate(Signed(body, "sk_live_bachs")).IsFailure);
    }

    /// <summary>Builds a genuinely-signed delivery for the clock <see cref="Build"/> installs.</summary>
    private static WebhookRequest Signed(string body, string secret)
    {
        const string timestamp = "1767225600"; // 2026-01-01T00:00:00Z
        using var hmac = new System.Security.Cryptography.HMACSHA256(
            System.Text.Encoding.UTF8.GetBytes(secret));
        var signature = Convert.ToHexStringLower(
            hmac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{timestamp}.{body}")));

        return new WebhookRequest(body, new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["X-Bachs-Signature"] = signature,
            ["X-Bachs-Timestamp"] = timestamp,
        });
    }

    // ---------------------------------------------------------------- half-configured

    [Theory]
    [InlineData("Bachs:SecretKey")]
    [InlineData("Bachs:BaseUrl")]
    // Without the signing secret we could take payments we can never verify.
    [InlineData("Bachs:WebhookSecret")]
    // Without the product map every checkout would be unmapped, or worse, a one-off charge.
    [InlineData("Bachs:ProductMap:pro_monthly")]
    public void A_half_configured_bachs_stays_a_stub(string missingKey)
    {
        var config = Config();
        config.Remove(missingKey);

        using var provider = Build(config);

        Assert.IsType<StubPaymentGateway>(
            provider.GetRequiredService<IPaymentGatewayFactory>().Resolve(PaymentProvider.Bachs));
        Assert.IsType<StubWebhookValidator>(
            provider.GetRequiredService<IEnumerable<IPaymentWebhookValidator>>()
                .Single(v => v.Provider == PaymentProvider.Bachs));
    }

    [Fact]
    public void An_unconfigured_deployment_registers_every_provider_as_a_stub()
    {
        using var provider = Build(new Dictionary<string, string?>());
        var factory = provider.GetRequiredService<IPaymentGatewayFactory>();

        foreach (var p in Enum.GetValues<PaymentProvider>())
            Assert.IsType<StubPaymentGateway>(factory.Resolve(p));
    }

    // ---------------------------------------------------------------- routing

    [Theory]
    [InlineData("Bachs", PaymentProvider.Bachs)]
    [InlineData("Paystack", PaymentProvider.Paystack)]
    public void Usd_follows_the_configured_default_provider(string defaultProvider, PaymentProvider expected)
    {
        // Both live providers support USD, so DefaultProvider is the whole routing lever — which is why
        // the deployment doc tells operators to set it when they want Bachs to take the money.
        using var provider = Build(Config(defaultProvider));

        var selected = provider.GetRequiredService<IPaymentGatewayFactory>().SelectForCurrency("USD");

        Assert.True(selected.IsSuccess);
        Assert.Equal(expected, selected.Value.Provider);
    }

    [Fact]
    public void A_currency_the_default_provider_cannot_charge_falls_through_to_one_that_can()
    {
        // Bachs is default but USD-only here; NGN must still find Paystack rather than fail or, worse,
        // be handed to a provider that would refuse it at the API.
        using var provider = Build(Config("Bachs"));

        var selected = provider.GetRequiredService<IPaymentGatewayFactory>().SelectForCurrency("ngn");

        Assert.True(selected.IsSuccess);
        Assert.Equal(PaymentProvider.Paystack, selected.Value.Provider);
    }
}
