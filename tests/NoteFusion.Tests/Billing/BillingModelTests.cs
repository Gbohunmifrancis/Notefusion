using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The billing model as one rule: naira plans are Paystack subscriptions, dollar plans are Bachs
/// subscriptions. These tests pin the routing under the production configuration and the startup
/// check that says when that routing cannot be paid for.
/// </summary>
public class BillingModelTests
{
    private static readonly DateTime Now = new(2026, 10, 2, 12, 0, 0, DateTimeKind.Utc);

    private static Dictionary<string, string?> Production(bool paystackConfigured = true, bool mapUsd = true) => new()
    {
        ["Billing:DefaultProvider"] = "Bachs",
        ["Paystack:SecretKey"] = paystackConfigured ? "sk_live_paystack" : "",
        ["Paystack:BaseUrl"] = "https://api.paystack.co",
        ["Paystack:SupportedCurrencies"] = "NGN",
        ["Bachs:SecretKey"] = "sk_live_bachs",
        ["Bachs:BaseUrl"] = "https://api.bachs.io",
        ["Bachs:WebhookSecret"] = "whsec_bachs",
        ["Bachs:SupportedCurrencies"] = "USD",
        ["Bachs:ProductMap:pro_monthly_usd"] = mapUsd ? "prod_month" : "",
        ["Bachs:ProductMap:pro_yearly"] = "prod_year", // the older bare key, still honoured
    };

    private static ServiceProvider Build(Dictionary<string, string?> config)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IDateTimeProvider>(new FixedClock(Now));
        services.AddBilling(new ConfigurationBuilder().AddInMemoryCollection(config).Build());
        return services.BuildServiceProvider();
    }

    private static readonly Plan[] Catalogue =
    [
        Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "Pro", 750_000, "NGN", BillingInterval.Monthly),
        Plan.Create(Guid.NewGuid(), "pro_yearly_ngn_v2", "Pro", 6_000_000, "NGN", BillingInterval.Yearly),
        Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "Pro", 999, "USD", BillingInterval.Monthly),
        Plan.Create(Guid.NewGuid(), "pro_yearly_usd", "Pro", 7_900, "USD", BillingInterval.Yearly),
    ];

    [Fact]
    public void Naira_routes_to_Paystack_and_dollars_to_Bachs()
    {
        using var sp = Build(Production());
        var factory = sp.GetRequiredService<IPaymentGatewayFactory>();

        Assert.Equal(PaymentProvider.Paystack, factory.SelectForCurrency("NGN").Value.Provider);
        Assert.Equal(PaymentProvider.Bachs, factory.SelectForCurrency("USD").Value.Provider);
        Assert.True(factory.SelectForCurrency("GBP").IsFailure);
    }

    [Fact]
    public void A_nigerian_account_sees_naira_plans_and_everyone_else_sees_dollars()
    {
        Assert.True(PlanEligibility.IsOffered("NGN", "NG"));
        Assert.False(PlanEligibility.IsOffered("USD", "NG"));
        Assert.True(PlanEligibility.IsOffered("USD", "US"));
        Assert.False(PlanEligibility.IsOffered("NGN", "GB"));
        Assert.True(PlanEligibility.IsOffered("USD", null)); // unknown country: the dollar tier
        Assert.False(PlanEligibility.IsOffered("NGN", null));
    }

    [Fact]
    public void The_production_configuration_is_ready_to_sell_every_plan()
    {
        using var sp = Build(Production());
        var problems = BillingReadiness.Check(Catalogue, sp.GetRequiredService<IPaymentGatewayFactory>(), sp.GetService<BachsOptions>());
        Assert.Empty(problems);
    }

    [Fact]
    public void A_missing_Paystack_key_leaves_the_naira_plans_unpayable_and_says_so()
    {
        using var sp = Build(Production(paystackConfigured: false));
        var problems = BillingReadiness.Check(Catalogue, sp.GetRequiredService<IPaymentGatewayFactory>(), sp.GetService<BachsOptions>());

        Assert.Equal(2, problems.Count);
        Assert.All(problems, p => Assert.Contains("Paystack", p));
        Assert.Contains(problems, p => p.Contains("pro_monthly_ngn") && p.Contains("Paystack__SecretKey"));
    }

    [Fact]
    public void Dollar_plans_need_no_bachs_catalog_product_because_every_checkout_is_one_off()
    {
        using var sp = Build(Production(mapUsd: false));
        var problems = BillingReadiness.Check(Catalogue, sp.GetRequiredService<IPaymentGatewayFactory>(), sp.GetService<BachsOptions>());

        Assert.Empty(problems);
    }

    [Fact]
    public void A_currency_suffixed_plan_code_falls_back_to_the_bare_product_mapping()
    {
        var options = new BachsOptions { ProductMap = new() { ["pro_yearly"] = "prod_year", ["pro_monthly_usd"] = "prod_month" } };

        Assert.Equal("prod_month", options.ProductIdFor("pro_monthly_usd"));
        Assert.Equal("prod_year", options.ProductIdFor("pro_yearly_usd"));
        Assert.Equal("prod_year", options.ProductIdFor("PRO_YEARLY"));
        Assert.Null(options.ProductIdFor("pro_yearly_ngn_v2")); // never maps a naira plan onto a dollar product
        Assert.Null(options.ProductIdFor("pro_lifetime"));
    }
}
