using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Ambient identity of the caller, resolved from the validated JWT and request context.</summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }
    Guid? UserId { get; }
    UserRole? Role { get; }
    string? Email { get; }
    string? FullName { get; }
}
