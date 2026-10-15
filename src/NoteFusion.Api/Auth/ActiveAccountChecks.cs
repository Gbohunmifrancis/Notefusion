using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.JsonWebTokens;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Auth;

/// <summary>
/// The per-request checks that make suspension and demotion take effect on access tokens already issued,
/// rather than only when they expire. Both read <see cref="UserAccessCache"/>.
/// </summary>
public static class ActiveAccountChecks
{
    /// <summary>
    /// JwtBearer's <c>OnTokenValidated</c>: a signature-valid token for an account that has since been
    /// suspended or deleted is refused, for every <c>[Authorize]</c> route and the SignalR hub alike.
    /// </summary>
    public static async Task RejectInactiveAccountAsync(TokenValidatedContext context)
    {
        if (UserIdOf(context.Principal) is not { } userId)
        {
            context.Fail("The token does not name an account.");
            return;
        }

        var services = context.HttpContext.RequestServices;
        var access = await services.GetRequiredService<UserAccessCache>()
            .GetAsync(userId, services.GetRequiredService<IApplicationDbContext>(), context.HttpContext.RequestAborted);

        if (!access.CanSignIn)
            context.Fail("This account is no longer active.");
    }

    internal static Guid? UserIdOf(ClaimsPrincipal? principal)
    {
        var value = principal?.FindFirstValue(JwtRegisteredClaimNames.Sub)
                    ?? principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var id) ? id : null;
    }
}

/// <summary>The caller must still be an active administrator according to the database, not only the token.</summary>
public sealed class CurrentAdminRequirement : IAuthorizationRequirement;

/// <summary>
/// Satisfies <see cref="CurrentAdminRequirement"/> from the account row (through the short cache), so an
/// admin demoted or suspended a moment ago is turned away from the console even with a token that still
/// says Admin.
/// </summary>
public sealed class CurrentAdminHandler : AuthorizationHandler<CurrentAdminRequirement>
{
    private readonly UserAccessCache _cache;
    private readonly IApplicationDbContext _db;
    private readonly IHttpContextAccessor _http;

    public CurrentAdminHandler(UserAccessCache cache, IApplicationDbContext db, IHttpContextAccessor http)
    {
        _cache = cache;
        _db = db;
        _http = http;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context, CurrentAdminRequirement requirement)
    {
        if (ActiveAccountChecks.UserIdOf(context.User) is not { } userId)
            return;

        var ct = _http.HttpContext?.RequestAborted ?? CancellationToken.None;
        if ((await _cache.GetAsync(userId, _db, ct)).IsAdmin)
            context.Succeed(requirement);
    }
}
