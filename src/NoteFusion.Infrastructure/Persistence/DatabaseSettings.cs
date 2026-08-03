namespace NoteFusion.Infrastructure.Persistence;

/// <summary>Database connection configuration, bound from the <c>Database</c> section / env.</summary>
public sealed class DatabaseSettings
{
    /// <summary>Full Npgsql connection string. Overrides the discrete fields below when set.</summary>
    public string? ConnectionString { get; set; }

    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 5432;
    public string Database { get; set; } = "notefusion";
    public string Username { get; set; } = "postgres";
    public string Password { get; set; } = "postgres";

    /// <summary>Applies EF Core migrations at startup (dev/compose convenience).</summary>
    public bool ApplyMigrationsAtStartup { get; set; } = true;
}
