using Npgsql;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Builds the Npgsql connection string from <see cref="DatabaseSettings"/>. A full
/// <c>ConnectionString</c> wins if provided (e.g. a managed-Postgres URL in production); otherwise
/// the discrete host/port/db/credential fields are assembled — the shape docker-compose uses.
/// </summary>
public static class ConnectionStringResolver
{
    public static string Resolve(DatabaseSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.ConnectionString))
            return settings.ConnectionString;

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = settings.Host,
            Port = settings.Port,
            Database = settings.Database,
            Username = settings.Username,
            Password = settings.Password
        };

        return builder.ConnectionString;
    }
}
