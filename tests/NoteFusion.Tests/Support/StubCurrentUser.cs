using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Support;

/// <summary>An in-test <see cref="ICurrentUser"/> whose identity the test controls directly.</summary>
public sealed class StubCurrentUser : ICurrentUser
{
    public StubCurrentUser(Guid? userId = null, UserRole role = UserRole.User, string? email = null, string? fullName = null)
    {
        UserId = userId;
        Role = userId is null ? null : role;
        Email = email;
        FullName = fullName;
    }

    public bool IsAuthenticated => UserId is not null;
    public Guid? UserId { get; }
    public UserRole? Role { get; }
    public string? Email { get; }
    public string? FullName { get; }
}
