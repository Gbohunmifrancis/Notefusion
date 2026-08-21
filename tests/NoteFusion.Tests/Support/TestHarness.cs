using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
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

        Auth = new AuthSettings();
        Tokens = new SecureTokenGenerator();
        var jwt = new JwtSettings();
        Keys = new RsaKeyProvider(jwt);
        Jwt = new JwtTokenService(Keys, jwt, Auth);
        TokenIssuer = new TokenIssuer(Jwt, Tokens, Hasher, Db, Clock, Auth);
        Email = new RecordingEmailSender();
        Push = new RecordingPushSender();
        Country = new StubCountryResolver();
        ClientIp = new StubClientIpAddress();
    }

    public ApplicationDbContext Db { get; }
    public FixedClock Clock { get; }
    public BcryptPasswordHasher Hasher { get; }
    public RsaKeyProvider Keys { get; }
    public JwtTokenService Jwt { get; }
    public TokenIssuer TokenIssuer { get; }

    /// <summary>Token lifetimes and the reset-link destination, at their configured defaults.</summary>
    public AuthSettings Auth { get; }

    /// <summary>The real generator, so reset and refresh tokens are the same shape they are in production.</summary>
    public SecureTokenGenerator Tokens { get; }

    /// <summary>Records what would have been sent, so a handler test can assert on it without a network.</summary>
    public RecordingEmailSender Email { get; }

    /// <summary>Same, for push. A notice that only emailed is a half-delivered notice.</summary>
    public RecordingPushSender Push { get; }

    /// <summary>Where the caller appears to be. Answers null until a test says otherwise.</summary>
    public StubCountryResolver Country { get; }

    /// <summary>The address the caller appears to come from. Answers null until a test says otherwise.</summary>
    public StubClientIpAddress ClientIp { get; }

    /// <summary>
    /// An audit logger acting as <paramref name="actor"/>, on this harness's context and clock. Admin
    /// handlers take <see cref="IAuditLogger"/>, so every one of their tests needs this pairing.
    /// </summary>
    public AuditLogger AuditAs(User actor)
        => new(Db, new StubCurrentUser(actor.Id, actor.Role, actor.Email, actor.FullName), ClientIp, Clock);

    /// <summary>
    /// Puts <paramref name="user"/> through email verification without the mail round trip, for the many
    /// tests whose subject is something else entirely and which only need an account that can sign in.
    /// </summary>
    /// <remarks>
    /// Goes through the real issue/consume pair rather than reaching for the flag, because the flag has no
    /// setter — and because a shortcut here would let the production path rot while every test kept
    /// passing. Does not save: the caller is mid-arrangement and owns the commit.
    /// </remarks>
    public void MarkEmailVerified(User user)
    {
        var code = EmailVerificationCodes.Issue(user, Tokens, Clock.UtcNow);
        if (!EmailVerificationCodes.Consume(user, code, Clock.UtcNow))
        {
            throw new InvalidOperationException(
                "A code issued a moment ago was refused — the verification rules have changed under this helper.");
        }
    }

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

/// <summary>
/// An <see cref="IEmailSender"/> that records calls instead of sending. The real sender is best-effort
/// and swallows failures, so a handler test can only observe intent, not delivery — this captures that
/// intent. Handlers that ignore the result of a send still exercise the call, so a missing send shows up.
/// </summary>
public sealed class RecordingEmailSender : IEmailSender
{
    public List<(string Kind, EmailRecipient To)> Sent { get; } = [];

    public Task SendWelcomeAsync(EmailRecipient to, CancellationToken ct = default)
    {
        Sent.Add(("welcome", to));
        return Task.CompletedTask;
    }

    public Task SendPasswordChangedAsync(EmailRecipient to, CancellationToken ct = default)
    {
        Sent.Add(("password-changed", to));
        return Task.CompletedTask;
    }

    public Task SendSubscriptionReceiptAsync(EmailRecipient to, SubscriptionReceipt receipt, CancellationToken ct = default)
    {
        Sent.Add(("receipt", to));
        Receipts.Add(receipt);
        return Task.CompletedTask;
    }

    public Task SendPaymentFailedAsync(EmailRecipient to, string planName, CancellationToken ct = default)
    {
        Sent.Add(("payment-failed", to));
        return Task.CompletedTask;
    }

    public Task SendPasswordResetAsync(EmailRecipient to, string resetUrl, CancellationToken ct = default)
    {
        Sent.Add(("password-reset", to));
        ResetUrls.Add(resetUrl);
        return Task.CompletedTask;
    }

    public Task SendEmailVerificationAsync(EmailRecipient to, string code, CancellationToken ct = default)
    {
        Sent.Add(("email-verification", to));
        VerificationCodes.Add(code);
        return Task.CompletedTask;
    }

    public Task SendSubscriptionExpiringAsync(
        EmailRecipient to, SubscriptionExpiry expiry, CancellationToken ct = default)
    {
        Sent.Add(("subscription-expiring", to));
        Expiring.Add(expiry);
        return Task.CompletedTask;
    }

    /// <summary>
    /// The expiry payloads, kept apart from <see cref="Sent"/> because the renew-vs-lapse wording and the
    /// day count are the part worth asserting on — the recipient alone does not distinguish them.
    /// </summary>
    public List<SubscriptionExpiry> Expiring { get; } = [];

    /// <summary>
    /// The receipt payloads, for the same reason: whether a purchase has a renewal date at all is the
    /// difference between a subscription receipt and a lifetime one, and <see cref="Sent"/> cannot show it.
    /// </summary>
    public List<SubscriptionReceipt> Receipts { get; } = [];

    /// <summary>
    /// The reset links, kept because <em>where</em> a reset link points is the security-relevant half of
    /// sending one — the recipient alone cannot show that the destination is ours.
    /// </summary>
    public List<string> ResetUrls { get; } = [];

    /// <summary>
    /// The plaintext verification codes, which is the only place a test can see one: the handler stores
    /// nothing but a hash, so the code that was mailed is otherwise unrecoverable — exactly as intended
    /// in production, and exactly why a test that wants to enter the right code has to read it here.
    /// </summary>
    public List<string> VerificationCodes { get; } = [];
}

/// <summary>
/// An <see cref="IPushSender"/> that records calls instead of delivering. Same reasoning as
/// <see cref="RecordingEmailSender"/>: pushes are fire-and-forget, so intent is all a handler test can see.
/// </summary>
public sealed class RecordingPushSender : IPushSender
{
    public List<(IReadOnlyList<Guid> Recipients, PushMessage Message)> Sent { get; } = [];

    public Task SendAsync(
        IReadOnlyList<Guid> recipientUserIds, PushMessage message, CancellationToken ct = default)
    {
        Sent.Add((recipientUserIds, message));
        return Task.CompletedTask;
    }
}

/// <summary>
/// An <see cref="ICountryResolver"/> that answers whatever a test sets, and null by default — which is the
/// state every account created before geolocation existed is in, and what production answers whenever the
/// lookup is switched off or fails. Defaulting to a country would leave "we do not know" untested, and that
/// is the case the pricing rules have to handle gracefully.
/// </summary>
public sealed class StubCountryResolver : ICountryResolver
{
    public string? Country { get; set; }

    /// <summary>
    /// How many times it was asked. The point of persisting the country is that a returning user costs no
    /// lookup, and only a call count can show that.
    /// </summary>
    public int Calls { get; private set; }

    public Task<string?> ResolveAsync(CancellationToken ct = default)
    {
        Calls++;
        return Task.FromResult(Country);
    }
}
