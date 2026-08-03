namespace NoteFusion.Core.Enums;

/// <summary>Account role. MVP has a single role; the enum exists so role-gated endpoints are explicit.</summary>
public enum UserRole
{
    User = 0,
    Admin = 1
}
