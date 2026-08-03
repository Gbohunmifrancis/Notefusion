using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Tests.Support;

/// <summary>
/// A self-contained backend fixture for handler tests: a real <see cref="ApplicationDbContext"/> over a
/// private in-memory SQLite database plus the real security services (bcrypt, RSA JWT, token issuer).
/// Using the real components — not mocks — means the tests exercise the same code paths that run in
/// production, including EF change-tracking and the owned-collection mapping.
/// </summary>
public sealed class TestHarness : IDisposable
{
    private readonly SqliteConnection _connection;

    public TestHarness(DateTime? now = null)
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(_connection)
            .Options;

        Db = new ApplicationDbContext(options);
        Db.Database.EnsureCreated();

        Clock = new FixedClock(now ?? new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc));
        Hasher = new BcryptPasswordHasher();

        var auth = new AuthSettings();
        var jwt = new JwtSettings();
        Keys = new RsaKeyProvider(jwt);
        Jwt = new JwtTokenService(Keys, jwt, auth);
        TokenIssuer = new TokenIssuer(Jwt, new SecureTokenGenerator(), Hasher, Db, Clock, auth);
    }

    public ApplicationDbContext Db { get; }
    public FixedClock Clock { get; }
    public BcryptPasswordHasher Hasher { get; }
    public RsaKeyProvider Keys { get; }
    public JwtTokenService Jwt { get; }
    public TokenIssuer TokenIssuer { get; }

    public void Dispose()
    {
        Db.Dispose();
        Keys.Dispose();
        _connection.Dispose();
    }
}

/// <summary>A controllable clock so lockout/expiry logic is deterministic.</summary>
public sealed class FixedClock : IDateTimeProvider
{
    public FixedClock(DateTime utcNow) => UtcNow = utcNow;
    public DateTime UtcNow { get; set; }
}
