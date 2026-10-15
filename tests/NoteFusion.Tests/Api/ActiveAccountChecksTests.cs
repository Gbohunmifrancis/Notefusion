using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Api.Auth;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Api;

/// <summary>
/// An access token outlives a suspension or a demotion by up to an hour. These checks read the account row
/// (through a short cache) on each request, so the token in hand stops working too.
/// </summary>
public class ActiveAccountChecksTests
{
    [Fact]
    public async Task A_token_for_an_active_account_is_accepted()
    {
        using var h = new TestHarness();
        var user = Seed(h, admin: false);

        var context = await Validate(h, user.Id);

        Assert.Null(context.Result?.Failure);
    }

    [Fact]
    public async Task A_token_for_a_suspended_account_is_refused()
    {
        using var h = new TestHarness();
        var user = Seed(h, admin: false);
        user.Suspend();
        h.Db.SaveChanges();

        var context = await Validate(h, user.Id);

        Assert.NotNull(context.Result?.Failure);
    }

    [Fact]
    public async Task A_token_for_a_deleted_account_or_without_a_subject_is_refused()
    {
        using var h = new TestHarness();

        Assert.NotNull((await Validate(h, Guid.NewGuid())).Result?.Failure);
        Assert.NotNull((await Validate(h, null)).Result?.Failure);
    }

    [Fact]
    public async Task The_admin_check_reads_the_role_from_the_account_not_the_token()
    {
        using var h = new TestHarness();
        var admin = Seed(h, admin: true);
        var other = Seed(h, admin: true, email: "other@notefusion.studio");

        Assert.True(await IsAdmin(h, admin.Id));

        // Demoted after the token was issued: the token still says Admin, the database does not.
        other.DemoteFromAdmin();
        h.Db.SaveChanges();
        Assert.False(await IsAdmin(h, other.Id));
    }

    [Fact]
    public async Task A_suspended_admin_is_not_an_admin()
    {
        using var h = new TestHarness();
        var admin = Seed(h, admin: true);
        admin.Suspend();
        h.Db.SaveChanges();

        Assert.False(await IsAdmin(h, admin.Id));
    }

    [Fact]
    public async Task The_answer_is_cached_so_a_burst_of_requests_reads_the_account_once()
    {
        using var h = new TestHarness();
        var user = Seed(h, admin: false);
        var cache = new UserAccessCache(new MemoryCache(new MemoryCacheOptions()));

        Assert.True((await cache.GetAsync(user.Id, h.Db, default)).CanSignIn);
        user.Suspend();
        h.Db.SaveChanges();

        // Within UserAccessCache.Lifetime the earlier answer stands; that window is the documented cost.
        Assert.True((await cache.GetAsync(user.Id, h.Db, default)).CanSignIn);
        Assert.True(UserAccessCache.Lifetime <= TimeSpan.FromSeconds(30));
    }

    private static User Seed(TestHarness h, bool admin, string email = "pat@notefusion.studio")
    {
        var user = admin
            ? User.CreateAdmin("Pat", email, "hash", h.Clock.UtcNow)
            : User.Create("Pat", email, "hash", h.Clock.UtcNow);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static ClaimsPrincipal Principal(Guid? userId, string role = "Admin")
    {
        var claims = new List<Claim> { new(ClaimTypes.Role, role) };
        if (userId is { } id)
            claims.Add(new Claim("sub", id.ToString()));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer"));
    }

    private static async Task<TokenValidatedContext> Validate(TestHarness h, Guid? userId)
    {
        var services = new ServiceCollection()
            .AddSingleton(new UserAccessCache(new MemoryCache(new MemoryCacheOptions())))
            .AddSingleton<IApplicationDbContext>(h.Db)
            .BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        var context = new TokenValidatedContext(
            http, new AuthenticationScheme(JwtBearerDefaults.AuthenticationScheme, null, typeof(JwtBearerHandler)),
            new JwtBearerOptions())
        {
            Principal = Principal(userId)
        };

        await ActiveAccountChecks.RejectInactiveAccountAsync(context);
        return context;
    }

    private static async Task<bool> IsAdmin(TestHarness h, Guid userId)
    {
        var requirement = new CurrentAdminRequirement();
        var handler = new CurrentAdminHandler(
            new UserAccessCache(new MemoryCache(new MemoryCacheOptions())), h.Db, new HttpContextAccessor());
        var context = new AuthorizationHandlerContext([requirement], Principal(userId), null);

        await handler.HandleAsync(context);
        return context.HasSucceeded;
    }
}
