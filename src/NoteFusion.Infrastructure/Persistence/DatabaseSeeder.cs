using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Applies pending migrations (when enabled) and seeds the admin account at startup. Runs once, in a
/// fresh DI scope so it can resolve the scoped DbContext. Idempotent: the admin id is deterministic
/// from its email, so re-running never creates a duplicate.
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
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task SeedAdminAsync(
        ApplicationDbContext context, IPasswordHasher hasher, IDateTimeProvider clock, CancellationToken ct)
    {
        var adminId = User.GenerateDeterministicId(_seed.AdminEmail);
        if (await context.Users.AnyAsync(u => u.Id == adminId, ct))
            return;

        var admin = User.CreateAdmin(
            _seed.AdminFullName,
            _seed.AdminEmail,
            hasher.Hash(_seed.AdminPassword),
            clock.UtcNow);

        context.Users.Add(admin);
        await context.SaveChangesAsync(ct);
        _logger.LogInformation("Seeded admin account {Email}.", admin.Email);
    }
}
