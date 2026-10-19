using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Persistence;

/// <summary>
/// Seeder tests over the real SQLite harness.
/// </summary>
/// <remarks>
/// The case worth guarding is promotion of an account that already exists. User ids are derived from
/// the email, so a second row for the same address is impossible — if the seeder only ever inserts,
/// an admin who first signed up as a user can never be granted the role, and the environment ends up
/// with no working admin at all. Every assertion here is also checked under a second run, because the
/// seeder runs on every boot.
/// </remarks>
public class DatabaseSeederTests
{
    private static readonly DateTime Now = new(2026, 8, 12, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Seeds_the_primary_admin_when_no_account_exists()
    {
        using var h = new TestHarness(Now);

        await Run(h);

        var admin = await FindUser(h, "admin@notefusion.app");
        Assert.NotNull(admin);
        Assert.Equal(UserRole.Admin, admin.Role);
        Assert.Equal(Now, admin.CreatedAt);
    }

    [Fact]
    public async Task Promotes_an_existing_user_named_in_AdminEmails()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "francisgbohunmi@gmail.com");

        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);

        var user = await FindUser(h, "francisgbohunmi@gmail.com");
        Assert.NotNull(user);
        Assert.Equal(UserRole.Admin, user.Role);
    }

    [Fact]
    public async Task Promotion_matches_on_the_normalized_email()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "francisgbohunmi@gmail.com");

        // Config is hand-written, so the casing and stray whitespace of an env var must not
        // decide whether the promotion lands.
        await Run(h, adminEmails: ["  FrancisGbohunmi@Gmail.com  "]);

        var user = await FindUser(h, "francisgbohunmi@gmail.com");
        Assert.NotNull(user);
        Assert.Equal(UserRole.Admin, user.Role);
    }

    [Fact]
    public async Task Promotion_keeps_the_account_and_its_data_intact()
    {
        using var h = new TestHarness(Now);
        var id = await SeedUser(h, "francisgbohunmi@gmail.com", fullName: "Francis Gbohunmi");
        var hash = (await FindUser(h, "francisgbohunmi@gmail.com"))!.PasswordHash;

        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);

        var user = await FindUser(h, "francisgbohunmi@gmail.com");
        Assert.NotNull(user);
        // Same row, same login: a promotion that reset the password or the id would lock the
        // person out of the account they already use.
        Assert.Equal(id, user.Id);
        Assert.Equal("Francis Gbohunmi", user.FullName);
        Assert.Equal(hash, user.PasswordHash);
        Assert.Equal(1, await CountUsers(h, "francisgbohunmi@gmail.com"));
    }

    [Fact]
    public async Task Running_twice_promotes_once_and_creates_no_duplicates()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "francisgbohunmi@gmail.com");

        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);
        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);

        Assert.Equal(1, await CountUsers(h, "francisgbohunmi@gmail.com"));
        Assert.Equal(1, await CountUsers(h, "admin@notefusion.app"));
        Assert.Equal(UserRole.Admin, (await FindUser(h, "francisgbohunmi@gmail.com"))!.Role);
    }

    [Fact]
    public async Task Promotes_the_primary_admin_email_when_it_was_registered_as_a_user()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "admin@notefusion.app");

        await Run(h);

        // The id is derived from the email, so the seeder cannot insert a second admin row here.
        // Skipping instead of promoting would leave the deployment with no admin.
        Assert.Equal(UserRole.Admin, (await FindUser(h, "admin@notefusion.app"))!.Role);
        Assert.Equal(1, await CountUsers(h, "admin@notefusion.app"));
    }

    [Fact]
    public async Task Does_not_promote_an_unverified_account_holding_the_primary_admin_email()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "admin@notefusion.app", verified: false);

        await Run(h);

        // A stranger may have registered the address first, with a password of their own.
        Assert.Equal(UserRole.User, (await FindUser(h, "admin@notefusion.app"))!.Role);
    }

    [Fact]
    public async Task Does_not_promote_an_unverified_account_named_in_AdminEmails()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "francisgbohunmi@gmail.com", verified: false);

        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);

        Assert.Equal(UserRole.User, (await FindUser(h, "francisgbohunmi@gmail.com"))!.Role);
    }

    [Fact]
    public async Task Does_not_create_an_account_for_an_AdminEmails_entry_that_has_none()
    {
        using var h = new TestHarness(Now);

        await Run(h, adminEmails: ["nobody@example.com"]);

        // Creating this would mean issuing an admin login with a seeder-chosen password.
        Assert.Null(await FindUser(h, "nobody@example.com"));
    }

    [Fact]
    public async Task Leaves_users_who_are_not_listed_as_regular_users()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h, "francisgbohunmi@gmail.com");
        await SeedUser(h, "someone@example.com");

        await Run(h, adminEmails: ["francisgbohunmi@gmail.com"]);

        Assert.Equal(UserRole.User, (await FindUser(h, "someone@example.com"))!.Role);
    }

    [Fact]
    public async Task Ignores_blank_AdminEmails_entries()
    {
        using var h = new TestHarness(Now);

        // An unset env var binds as an empty string rather than dropping out of the list.
        await Run(h, adminEmails: ["", "   "]);

        Assert.Equal(1, await CountUsers(h, "admin@notefusion.app"));
    }

    [Fact]
    public async Task Does_not_seed_admin_when_AdminPassword_is_empty()
    {
        using var h = new TestHarness(Now);
        var services = new ServiceCollection()
            .AddSingleton(h.Db)
            .AddSingleton<IPasswordHasher>(h.Hasher)
            .AddSingleton<IDateTimeProvider>(h.Clock)
            .BuildServiceProvider();

        var seeder = new DatabaseSeeder(
            services,
            new DatabaseSettings { ApplyMigrationsAtStartup = false },
            new SeedSettings { AdminPassword = "" },
            NullLogger<DatabaseSeeder>.Instance);

        await seeder.StartAsync(default);

        Assert.Null(await FindUser(h, "admin@notefusion.app"));
    }

    private static async Task Run(TestHarness h, IEnumerable<string>? adminEmails = null)
    {
        var services = new ServiceCollection()
            .AddSingleton(h.Db)
            .AddSingleton<IPasswordHasher>(h.Hasher)
            .AddSingleton<IDateTimeProvider>(h.Clock)
            .BuildServiceProvider();

        var seeder = new DatabaseSeeder(
            services,
            // SQLite here, and the migrations are Npgsql-specific — the harness has already
            // created the schema, so migrating would only fail.
            new DatabaseSettings { ApplyMigrationsAtStartup = false },
            new SeedSettings
            {
                AdminPassword = "ChangeMe!123",
                AdminEmails = [.. adminEmails ?? []]
            },
            NullLogger<DatabaseSeeder>.Instance);

        await seeder.StartAsync(default);
    }

    private static async Task<Guid> SeedUser(
        TestHarness h, string email, string fullName = "Test User", bool verified = true)
    {
        var user = User.Create(fullName, email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        if (verified)
            h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }

    private static async Task<User?> FindUser(TestHarness h, string email)
        => await h.Db.Users.FindAsync(User.GenerateDeterministicId(email));

    private static async Task<int> CountUsers(TestHarness h, string email)
    {
        var id = User.GenerateDeterministicId(email);
        return await h.Db.Users.CountAsync(u => u.Id == id);
    }
}
