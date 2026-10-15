using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Applies pending migrations (when enabled) and seeds administrators at startup. Runs once, in a
/// fresh DI scope so it can resolve the scoped DbContext. Idempotent: the admin id is deterministic
/// from its email, so re-running never creates a duplicate, and promotions are no-ops once applied.
/// </summary>
public sealed class DatabaseSeeder : IHostedService
{
    private readonly IServiceProvider _services;
    private readonly DatabaseSettings _database;
    private readonly SeedSettings _seed;
    private readonly ILogger<DatabaseSeeder> _logger;

    public DatabaseSeeder(
        IServiceProvider services,
        DatabaseSettings database,
        SeedSettings seed,
        ILogger<DatabaseSeeder> logger)
    {
        _services = services;
        _database = database;
        _seed = seed;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using var scope = _services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var clock = scope.ServiceProvider.GetRequiredService<IDateTimeProvider>();

        if (_database.ApplyMigrationsAtStartup)
        {
            _logger.LogInformation("Applying database migrations…");
            await context.Database.MigrateAsync(cancellationToken);
        }

        await SeedAdminAsync(context, hasher, clock, cancellationToken);

        // Not fatal: until a row has its inbox, that account's free allowance is shared per account and
        // device only, as it was before the column existed. Failing the start over it would be worse.
        try
        {
            var filled = await CanonicalEmailBackfill.RunAsync(context, cancellationToken);
            if (filled > 0)
                _logger.LogInformation("Filled the canonical inbox on {Count} accounts.", filled);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Could not fill the canonical inbox on existing accounts; will retry at next start.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task SeedAdminAsync(
        ApplicationDbContext context, IPasswordHasher hasher, IDateTimeProvider clock, CancellationToken ct)
    {
        var adminId = User.GenerateDeterministicId(_seed.AdminEmail);
        var primary = await context.Users.FirstOrDefaultAsync(u => u.Id == adminId, ct);

        if (primary is null)
        {
            if (string.IsNullOrWhiteSpace(_seed.AdminPassword))
            {
                _logger.LogWarning(
                    "Cannot seed admin account {Email} because Seed:AdminPassword is not configured.",
                    _seed.AdminEmail);
            }
            else
            {
                primary = User.CreateAdmin(
                    _seed.AdminFullName,
                    _seed.AdminEmail,
                    hasher.Hash(_seed.AdminPassword),
                    clock.UtcNow);

                context.Users.Add(primary);
                _logger.LogInformation("Seeded admin account {Email}.", primary.Email);
            }
        }
        else if (primary.PromoteToAdmin())
        {
            // Someone signed up with the configured admin address before the seeder first ran.
            // Creating a second account is impossible (the id is derived from the email), so
            // without this the environment would have no admin at all.
            _logger.LogInformation("Promoted existing account {Email} to admin.", primary.Email);
        }

        await PromoteConfiguredAdminsAsync(context, adminId, ct);

        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Grants the admin role to accounts named in <c>Seed:AdminEmails</c>. Config-driven so a
    /// deployment can add an admin with an env var instead of hand-written SQL against production.
    /// </summary>
    private async Task PromoteConfiguredAdminsAsync(
        ApplicationDbContext context, Guid primaryAdminId, CancellationToken ct)
    {
        foreach (var email in _seed.AdminEmails)
        {
            if (string.IsNullOrWhiteSpace(email))
                continue;

            var id = User.GenerateDeterministicId(email);
            if (id == primaryAdminId)
                continue; // Already handled above, and it may be an unsaved insert.

            var user = await context.Users.FirstOrDefaultAsync(u => u.Id == id, ct);
            if (user is null)
            {
                // Deliberately not created: the seeder has no password for this person, and
                // inventing one would hand out an admin login nobody asked for.
                _logger.LogWarning(
                    "Cannot promote {Email} to admin — no account with that email exists.", email);
                continue;
            }

            if (user.PromoteToAdmin())
                _logger.LogInformation("Promoted existing account {Email} to admin.", user.Email);
        }
    }
}
