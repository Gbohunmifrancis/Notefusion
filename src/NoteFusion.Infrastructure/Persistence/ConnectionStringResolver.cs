using Npgsql;

namespace NoteFusion.Infrastructure.Persistence;

/// <summary>
/// Builds the Npgsql connection string from <see cref="DatabaseSettings"/>.
/// Supports Heroku DATABASE_URL (postgres://user:pass@host:port/db) automatically,
/// managed Postgres connection strings, or discrete host/port/db/credential fields.
/// </summary>
public static class ConnectionStringResolver
{
    public static string Resolve(DatabaseSettings settings)
    {
        var rawConn = !string.IsNullOrWhiteSpace(settings.ConnectionString)
            ? settings.ConnectionString
            : Environment.GetEnvironmentVariable("DATABASE_URL");

        if (!string.IsNullOrWhiteSpace(rawConn))
        {
            if (rawConn.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
                rawConn.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
            {
                var uri = new Uri(rawConn);
                var userInfo = uri.UserInfo.Split(':');
                var builder = new NpgsqlConnectionStringBuilder
                {
                    Host = uri.Host,
                    Port = uri.Port > 0 ? uri.Port : 5432,
                    Username = userInfo.Length > 0 ? System.Net.WebUtility.UrlDecode(userInfo[0]) : "",
                    Password = userInfo.Length > 1 ? System.Net.WebUtility.UrlDecode(userInfo[1]) : "",
                    Database = uri.AbsolutePath.TrimStart('/'),
                    SslMode = SslMode.Require,
                    TrustServerCertificate = true
                };
                return builder.ConnectionString;
            }
            return rawConn;
        }

        var fallbackBuilder = new NpgsqlConnectionStringBuilder
        {
            Host = settings.Host,
            Port = settings.Port,
            Database = settings.Database,
            Username = settings.Username,
            Password = settings.Password
        };

        return fallbackBuilder.ConnectionString;
    }
}
