using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;

namespace NoteFusion.Infrastructure.Billing;

/// <summary>
/// Seeds the fixed Pro plans at startup. Plans are product-defined (not user- or config-created), so
/// they live in code with deterministic ids derived from their code — re-running never duplicates a
/// plan, and an existing plan is left untouched (price changes ship as new plan codes, so historical
/// charges stay traceable to the price the user actually agreed to).
/// </summary>
public sealed class BillingSeeder : IHostedService
{
    // The geo split (docs/geo-billing-plan.md): a Nigerian account subscribes in naira through Paystack,
    // everyone else buys Pro once, for life, in dollars. Amounts are minor units — cents for USD, kobo for
    // NGN. Yearly is priced as ten months to reward the annual commitment; the lifetime price is roughly a
    // year and a half of it, which is the standing $79 rather than the launch-cohort discount (that would
    // ship as its own code, since a price is only traceable if it never moves under an existing one).
    private static readonly (string Code, string Name, long AmountMinor, string Currency, BillingInterval Interval)[] Plans =
    [
        ("pro_monthly_ngn", "NoteFusion Pro (Monthly)",   750_000,   "NGN", BillingInterval.Monthly),
        ("pro_yearly_ngn",  "NoteFusion Pro (Yearly)",    7_500_000, "NGN", BillingInterval.Yearly),
        ("pro_lifetime",    "NoteFusion Pro (Lifetime)",  7_900,     "USD", BillingInterval.Lifetime),
    ];

    // Codes that must no longer be sold. The two USD subscriptions are not merely superseded, they are
    // unpayable: Bachs subscriptions are card-only, this account has no USD card rail, and their checkout
    // renders an empty payment-method list — so leaving them active would offer an international buyer two
    // tiers that cannot complete. test_ngn_monthly was only ever a probe. Retiring is a flag flip and not a
    // delete, because fulfilment and every receipt read the plan by id long after it stops being on sale.
    private static readonly string[] RetiredCodes = ["pro_monthly", "pro_yearly", "test_ngn_monthly"];

    private readonly IServiceProvider _services;
    private readonly ILogger<BillingSeeder> _logger;

    public BillingSeeder(IServiceProvider services, ILogger<BillingSeeder> logger)
    {
        _services = services;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

        // Runs after DatabaseSeeder has applied migrations (hosted services start in registration
        // order), so the schema is in place — same assumption the admin seeder makes.
        var seeded = 0;
        foreach (var (code, name, amountMinor, currency, interval) in Plans)
        {
            var id = DeterministicId(code);
            if (await db.Plans.AnyAsync(p => p.Id == id, cancellationToken))
                continue;

            db.Plans.Add(Plan.Create(id, code, name, amountMinor, currency, interval));
            seeded++;
        }

        // Matched on code rather than on the deterministic id, because a plan can also have been created by
        // hand against the live database — which is exactly what test_ngn_monthly was.
        var retired = await db.Plans
            .Where(p => p.IsActive && RetiredCodes.Contains(p.Code))
            .ToListAsync(cancellationToken);

        foreach (var plan in retired)
            plan.Retire();

        if (seeded > 0 || retired.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation(
                "Seeded {Seeded} billing plan(s), retired {Retired}.", seeded, retired.Count);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static Guid DeterministicId(string code)
    {
        using var md5 = System.Security.Cryptography.MD5.Create();
        var hash = md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"plan:{code}"));
        return new Guid(hash);
    }
}
