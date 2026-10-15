using Microsoft.AspNetCore.Authorization;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Auth;

/// <summary>
/// Named authorization policies. Declared in one place so a controller cannot silently invent its
/// own spelling of a role string and end up gating on a claim value that is never issued.
/// </summary>
public static class AuthorizationPolicies
{
    /// <summary>
    /// Requires an authenticated caller holding the Admin role claim who is, according to the database
    /// (<see cref="CurrentAdminRequirement"/>), still an active administrator.
    /// </summary>
    public const string Admin = "Admin";

    public static AuthorizationOptions AddNoteFusionPolicies(this AuthorizationOptions options)
    {
        // The role claim is written by JwtTokenService as UserRole.ToString(), so the required value
        // is taken from the enum rather than a literal — the two cannot drift.
        options.AddPolicy(Admin, policy => policy
            .RequireAuthenticatedUser()
            .RequireRole(nameof(UserRole.Admin))
            .AddRequirements(new CurrentAdminRequirement()));

        return options;
    }
}
