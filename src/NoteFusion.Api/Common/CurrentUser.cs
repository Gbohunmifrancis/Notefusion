using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Common;

/// <summary>
/// Resolves the authenticated caller from the validated JWT. Inbound claim mapping is turned off in the
/// bearer options, so claims arrive under their raw JWT names (<c>sub</c>, <c>email</c>, <c>name</c>);
/// role is written as the <see cref="ClaimTypes.Role"/> URI by the token service.
/// </summary>
public sealed class CurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _http;

    public CurrentUser(IHttpContextAccessor http) => _http = http;

    private ClaimsPrincipal? Principal => _http.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public Guid? UserId
    {
        get
        {
            var value = Principal?.FindFirstValue(JwtRegisteredClaimNames.Sub)
                        ?? Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(value, out var id) ? id : null;
        }
    }

    public UserRole? Role
    {
        get
        {
            var value = Principal?.FindFirstValue(ClaimTypes.Role);
            return Enum.TryParse<UserRole>(value, out var role) ? role : null;
        }
    }

    public string? Email => Principal?.FindFirstValue(JwtRegisteredClaimNames.Email);
    public string? FullName => Principal?.FindFirstValue(JwtRegisteredClaimNames.Name);
}
