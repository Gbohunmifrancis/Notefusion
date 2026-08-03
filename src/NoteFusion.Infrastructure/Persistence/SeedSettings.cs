namespace NoteFusion.Infrastructure.Persistence;

/// <summary>The seeded administrator account, bound from the <c>Seed</c> section / env.</summary>
public sealed class SeedSettings
{
    public string AdminFullName { get; set; } = "NoteFusion Admin";
    public string AdminEmail { get; set; } = "admin@notefusion.app";
    public string AdminPassword { get; set; } = "ChangeMe!123";
}
