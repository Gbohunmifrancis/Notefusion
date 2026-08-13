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
    // USD, in cents. Yearly is priced as ten months to reward the annual commitment.
    private static readonly (string Code, string Name, long AmountMinor, BillingInterval Interval)[] Plans =
    [
        ("pro_monthly", "NoteFusion Pro (Monthly)", 499, BillingInterval.Monthly),
        ("pro_yearly",  "NoteFusion Pro (Yearly)",  4990, BillingInterval.Yearly),
    ];

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
        foreach (var (code, name, amountMinor, interval) in Plans)
        {
            var id = DeterministicId(code);
            if (await db.Plans.AnyAsync(p => p.Id == id, cancellationToken))
                continue;

            db.Plans.Add(Plan.Create(id, code, name, amountMinor, "USD", interval));
            seeded++;
        }

        if (seeded > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Seeded {Count} billing plan(s).", seeded);
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
