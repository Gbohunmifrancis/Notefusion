namespace NoteFusion.Infrastructure.Persistence;

/// <summary>The seeded administrator account, bound from the <c>Seed</c> section / env.</summary>
public sealed class SeedSettings
{
    public string AdminFullName { get; set; } = "NoteFusion Admin";
    public string AdminEmail { get; set; } = "admin@notefusion.app";
    public string AdminPassword { get; set; } = "ChangeMe!123";

    /// <summary>
    /// Accounts that already signed up as regular users and should hold the admin role. Kept
    /// separate from <see cref="AdminEmail"/> because these are promotions, not creations: the
    /// account exists with its own password and transcriptions, and re-creating it would orphan
    /// them. Emails listed here that have no account yet are skipped (and logged) — the seeder
    /// will not invent a password for someone. Env form: <c>Seed__AdminEmails__0</c>.
    /// </summary>
    public List<string> AdminEmails { get; set; } = [];
}
