using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Push;
using NoteFusion.Application.Push.Commands;
using NoteFusion.Application.Push.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Push;

/// <summary>
/// Web push for the web app: browsers subscribe (their own rows only), and a finished job is encrypted to each
/// browser (RFC 8291) and signed with our VAPID key (RFC 8292). A browser's subscription is only usable with the
/// key it was made with, so the derived pair must be stable; and a push service that says "gone" means the row goes.
/// </summary>
public class WebPushTests
{
    private const string Endpoint = "https://fcm.googleapis.com/fcm/send/dXNlcjE:APA91bH";

    // A browser's side of a subscription: its P-256 key pair and its auth secret.
    private static readonly ECDiffieHellman Browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    private static readonly byte[] AuthSecret = RandomNumberGenerator.GetBytes(16);
    public static readonly string BrowserKey = Base64Url.EncodeToString(PublicPoint(Browser.ExportParameters(false)));
    public static readonly string BrowserAuth = Base64Url.EncodeToString(AuthSecret);

    public static VapidKeys Keys(TestHarness h) => VapidKeys.Resolve(new WebPushSettings(), h.Keys);

    // ---------------------------------------------------------------- subscriptions

    [Fact]
    public async Task Subscribing_saves_the_callers_browser_once_however_often_it_is_sent()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        Assert.True((await Save(h, user.Id, Subscription())).IsSuccess);
        h.Db.ChangeTracker.Clear();
        h.Clock.UtcNow = h.Clock.UtcNow.AddDays(1);
        Assert.True((await Save(h, user.Id, Subscription())).IsSuccess);

        var row = await h.Db.WebPushSubscriptions.SingleAsync();
        Assert.Equal(user.Id, row.UserId);
        Assert.Equal(BrowserKey, row.P256dh);
        Assert.Equal(BrowserAuth, row.Auth);
        Assert.Equal("Mozilla/5.0 Test", row.UserAgent);
        Assert.Equal(h.Clock.UtcNow, row.UpdatedAtUtc);
    }

    [Fact]
    public async Task A_browser_that_signs_into_another_account_sends_only_that_accounts_notifications()
    {
        using var h = new TestHarness();
        var first = await SeedUser(h);
        var second = await SeedUser(h, "second@example.com");

        await Save(h, first.Id, Subscription());
        h.Db.ChangeTracker.Clear();
        await Save(h, second.Id, Subscription());

        Assert.Equal(second.Id, (await h.Db.WebPushSubscriptions.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Deleting_removes_only_the_callers_own_row()
    {
        using var h = new TestHarness();
        var mine = await SeedUser(h);
        var theirs = await SeedUser(h, "other@example.com");
        await Save(h, theirs.Id, Subscription());
        h.Db.ChangeTracker.Clear();

        // An old session of another account on the same browser signing out must not take it away.
        var result = await new DeleteWebPushSubscriptionCommandHandler(h.Db, new StubCurrentUser(mine.Id))
            .Handle(new DeleteWebPushSubscriptionCommand(Endpoint), default);

        Assert.True(result.IsSuccess);
        Assert.True(await h.Db.WebPushSubscriptions.AnyAsync(s => s.UserId == theirs.Id));

        result = await new DeleteWebPushSubscriptionCommandHandler(h.Db, new StubCurrentUser(theirs.Id))
            .Handle(new DeleteWebPushSubscriptionCommand(Endpoint), default);
        Assert.True(result.IsSuccess);
        Assert.False(await h.Db.WebPushSubscriptions.AnyAsync());
    }

    [Fact]
    public async Task An_unauthenticated_caller_can_neither_subscribe_nor_unsubscribe()
    {
        using var h = new TestHarness();
        var owner = await SeedUser(h);
        await Save(h, owner.Id, Subscription());

        var saved = await new SaveWebPushSubscriptionCommandHandler(h.Db, h.Clock, new StubCurrentUser(null), Keys(h))
            .Handle(Subscription(), default);
        var deleted = await new DeleteWebPushSubscriptionCommandHandler(h.Db, new StubCurrentUser(null))
            .Handle(new DeleteWebPushSubscriptionCommand(Endpoint), default);

        Assert.True(saved.IsFailure);
        Assert.True(deleted.IsFailure);
        Assert.Equal(owner.Id, (await h.Db.WebPushSubscriptions.SingleAsync()).UserId);
    }

    [Theory]
    [InlineData("http://fcm.googleapis.com/fcm/send/x")]          // not https
    [InlineData("https://localhost/fcm/send/x")]                  // the server calling itself
    [InlineData("https://10.0.0.5/push")]
    [InlineData("https://fcm.googleapis.com.evil.example/x")]     // a lookalike suffix
    [InlineData("https://evil.example/fcm.googleapis.com")]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/x")]    // another port
    [InlineData("https://user@fcm.googleapis.com/fcm/send/x")]
    [InlineData("https://jmt17.google.com.evil.example/x")]
    [InlineData("https://accounts.google.com/x")]
    public async Task An_endpoint_off_the_known_push_services_is_refused(string endpoint)
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        var result = await Save(h, user.Id, Subscription(endpoint));

        Assert.True(result.IsFailure);
        Assert.Equal("WEBPUSH_ENDPOINT_NOT_ALLOWED", result.Error.Code);
        Assert.False(await h.Db.WebPushSubscriptions.AnyAsync());
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc")]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")]
    [InlineData("https://web.push.apple.com/QGuQyavXutnMH")]
    [InlineData("https://wns2-par02p.notify.windows.com/w/?token=BQYAAA")]
    [InlineData("https://jmt17.google.com/fcm/send/f2L7Rt-U_fE:APA91bE")] // Chromium without Chrome's keys
    public void The_major_browsers_push_services_are_allowed(string endpoint)
        => Assert.True(WebPush.IsAllowedEndpoint(endpoint));

    [Fact]
    public void Keys_that_are_not_a_browsers_P256_key_and_auth_secret_are_rejected()
    {
        var validator = new SaveWebPushSubscriptionCommandValidator();

        Assert.True(validator.Validate(Subscription()).IsValid);
        Assert.False(validator.Validate(new SaveWebPushSubscriptionCommand(Endpoint, null)).IsValid);
        Assert.False(validator.Validate(new SaveWebPushSubscriptionCommand(Endpoint, new WebPushSubscriptionKeysDto("abc", BrowserAuth))).IsValid);
        Assert.False(validator.Validate(new SaveWebPushSubscriptionCommand(Endpoint, new WebPushSubscriptionKeysDto(BrowserKey, BrowserKey))).IsValid);
        // 65 bytes but not an uncompressed point.
        var notAPoint = Base64Url.EncodeToString(new byte[65]);
        Assert.False(validator.Validate(new SaveWebPushSubscriptionCommand(Endpoint, new WebPushSubscriptionKeysDto(notAPoint, BrowserAuth))).IsValid);
    }

    [Fact]
    public async Task An_account_keeps_its_most_recent_browsers_only()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);

        for (var i = 0; i < WebPush.MaxSubscriptionsPerUser + 3; i++)
        {
            h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(1);
            await Save(h, user.Id, Subscription($"https://fcm.googleapis.com/fcm/send/{i}"));
        }

        var kept = await h.Db.WebPushSubscriptions.Select(s => s.Endpoint).ToListAsync();
        Assert.Equal(WebPush.MaxSubscriptionsPerUser, kept.Count);
        Assert.Contains($"https://fcm.googleapis.com/fcm/send/{WebPush.MaxSubscriptionsPerUser + 2}", kept);
        Assert.DoesNotContain("https://fcm.googleapis.com/fcm/send/0", kept);
    }

    [Fact]
    public async Task With_web_push_off_there_is_no_key_and_nothing_to_subscribe_to()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        var off = VapidKeys.Resolve(new WebPushSettings { Enabled = false }, h.Keys);

        var key = await new GetWebPushKeyQueryHandler(off).Handle(new GetWebPushKeyQuery(), default);
        var saved = await new SaveWebPushSubscriptionCommandHandler(h.Db, h.Clock, new StubCurrentUser(user.Id), off)
            .Handle(Subscription(), default);

        Assert.Equal("WEBPUSH_OFF", key.Error.Code);
        Assert.Equal("WEBPUSH_OFF", saved.Error.Code);
    }

    // ---------------------------------------------------------------- the key pair

    [Fact]
    public async Task The_derived_key_pair_is_stable_for_one_signing_key_and_handed_out_as_is()
    {
        using var h = new TestHarness();
        var once = Keys(h);
        var again = VapidKeys.Resolve(new WebPushSettings(), h.Keys);
        using var otherSigningKey = new RsaKeyProvider(new JwtSettings());
        var other = VapidKeys.Resolve(new WebPushSettings(), otherSigningKey);

        Assert.Equal("derived", once.Source);
        Assert.Equal(once.PublicKey, again.PublicKey);
        Assert.Equal(once.PrivateKey, again.PrivateKey);
        Assert.NotEqual(once.PublicKey, other.PublicKey);
        Assert.Equal(65, Base64Url.DecodeFromChars(once.PublicKey!).Length);

        var handedOut = await new GetWebPushKeyQueryHandler(once).Handle(new GetWebPushKeyQuery(), default);
        Assert.Equal(once.PublicKey, handedOut.Value.PublicKey);
    }

    [Fact]
    public void A_configured_pair_is_used_and_a_broken_one_turns_web_push_off()
    {
        using var h = new TestHarness();
        using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(true);
        var publicKey = Base64Url.EncodeToString(PublicPoint(p));
        var privateKey = Base64Url.EncodeToString(p.D!);

        var configured = VapidKeys.Resolve(new WebPushSettings { PublicKey = publicKey, PrivateKey = privateKey }, h.Keys);
        Assert.Equal("configured", configured.Source);
        Assert.Equal(publicKey, configured.PublicKey);

        Assert.False(VapidKeys.Resolve(new WebPushSettings { PublicKey = publicKey }, h.Keys).IsOn);
        Assert.False(VapidKeys.Resolve(new WebPushSettings { PublicKey = Keys(h).PublicKey, PrivateKey = privateKey }, h.Keys).IsOn);
        Assert.False(VapidKeys.Resolve(new WebPushSettings { PublicKey = "nonsense", PrivateKey = "nonsense" }, h.Keys).IsOn);
        Assert.False(VapidKeys.Resolve(new WebPushSettings { Enabled = false }, h.Keys).IsOn);
    }

    // ---------------------------------------------------------------- sending

    [Fact]
    public async Task A_push_is_encrypted_to_the_browser_and_signed_with_the_vapid_key()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);
        var service = new PushService(HttpStatusCode.Created);
        var keys = Keys(h);

        await Sender(h, service, keys).SendAsync(user.Id, WebPush.Ready("job-7", "Amazing Grace"));

        var request = Assert.Single(service.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(Endpoint, request.Uri);
        Assert.Equal("aes128gcm", request.ContentEncoding);
        Assert.Equal("86400", request.Headers["TTL"]);
        Assert.Equal("high", request.Headers["Urgency"]);

        // RFC 8292: "vapid t=<ES256 JWT for the endpoint's origin>, k=<our public key>".
        var auth = request.Headers["Authorization"];
        Assert.StartsWith("vapid ", auth);
        var token = auth.Split("t=")[1].Split(',')[0].Trim();
        Assert.Equal(keys.PublicKey, auth.Split("k=")[1].Trim());
        var parts = token.Split('.');
        using (var claims = JsonDocument.Parse(Base64Url.DecodeFromChars(parts[1])))
        {
            Assert.Equal("https://fcm.googleapis.com", claims.RootElement.GetProperty("aud").GetString());
            Assert.Equal("mailto:hello@notefusion.studio", claims.RootElement.GetProperty("sub").GetString());
        }
        using var verifier = ECDsa.Create(PublicParameters(Base64Url.DecodeFromChars(keys.PublicKey!)));
        Assert.True(verifier.VerifyData(
            Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]), Base64Url.DecodeFromChars(parts[2]), HashAlgorithmName.SHA256));

        // RFC 8291: only the browser's private key and auth secret open it.
        using var payload = JsonDocument.Parse(Decrypt(request.Body));
        Assert.Equal("Your sheet is ready", payload.RootElement.GetProperty("title").GetString());
        Assert.Equal("“Amazing Grace” is written out. Open it in NoteFusion.", payload.RootElement.GetProperty("body").GetString());
        Assert.Equal("nf-job-job-7", payload.RootElement.GetProperty("tag").GetString());
        Assert.Equal("/app?job=job-7", payload.RootElement.GetProperty("url").GetString());
        Assert.Equal("ready", payload.RootElement.GetProperty("kind").GetString());

        Assert.Equal(h.Clock.UtcNow, (await h.Db.WebPushSubscriptions.SingleAsync()).LastSuccessAtUtc);
    }

    [Theory]
    [InlineData(HttpStatusCode.Gone)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task A_subscription_the_push_service_calls_gone_is_removed(HttpStatusCode status)
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);

        await Sender(h, new PushService(status), Keys(h)).SendAsync(user.Id, WebPush.Ready("job-1", null));

        Assert.False(await h.Db.WebPushSubscriptions.AnyAsync());
    }

    [Fact]
    public async Task A_subscription_that_keeps_being_refused_is_dropped_in_the_end()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);
        var sender = Sender(h, new PushService(HttpStatusCode.Forbidden), Keys(h));

        for (var i = 1; i < WebPushSubscription.MaxFailures; i++)
        {
            await sender.SendAsync(user.Id, WebPush.Ready("job-1", null));
            Assert.Equal(i, (await h.Db.WebPushSubscriptions.SingleAsync()).FailureCount);
        }
        await sender.SendAsync(user.Id, WebPush.Ready("job-1", null));

        Assert.False(await h.Db.WebPushSubscriptions.AnyAsync());
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task A_busy_or_broken_push_service_is_not_held_against_the_browser(HttpStatusCode status)
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);
        var service = new PushService(status);

        await Sender(h, service, Keys(h)).SendAsync(user.Id, WebPush.Ready("job-1", null));

        Assert.Single(service.Requests); // and not re-sent on its Retry-After
        Assert.Equal(0, (await h.Db.WebPushSubscriptions.SingleAsync()).FailureCount);
    }

    [Fact]
    public async Task Nothing_is_sent_when_web_push_is_off()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);
        var service = new PushService(HttpStatusCode.Created);

        await Sender(h, service, VapidKeys.Resolve(new WebPushSettings { Enabled = false }, h.Keys))
            .SendAsync(user.Id, WebPush.Ready("job-1", null));

        Assert.Empty(service.Requests);
    }

    [Fact]
    public async Task A_timeout_is_logged_not_thrown_but_the_callers_cancellation_still_cancels()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        await Subscribe(h, user.Id);

        await Sender(h, StubHttpMessageHandler.Throwing(new TaskCanceledException("timed out")), Keys(h))
            .SendAsync(user.Id, WebPush.Ready("job-1", null));

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Sender(h, new PushService(HttpStatusCode.Created), Keys(h)).SendAsync(user.Id, WebPush.Ready("job-1", null), cts.Token));
    }

    [Fact]
    public void The_payload_names_the_job_as_the_tab_does()
    {
        Assert.Equal("Amazing Grace", WebPush.NameOf(null, "Amazing Grace.m4a"));
        Assert.Equal("Way Maker", WebPush.NameOf("Way Maker", "upload.mp3"));
        Assert.Null(WebPush.NameOf(null, null));
        Assert.Equal("Open it in NoteFusion.", WebPush.Ready("j", null).Body);
        Assert.Equal("“Hymn”: Too quiet.", WebPush.Failed("j", "Hymn", "Too quiet.").Body);
        Assert.Equal(WebPush.MaxBodyLength, WebPush.Failed("j", null, new string('x', 1000)).Body.Length);
    }

    // ---------------------------------------------------------------- fixtures

    private static SaveWebPushSubscriptionCommand Subscription(string endpoint = Endpoint)
        => new(endpoint, new WebPushSubscriptionKeysDto(BrowserKey, BrowserAuth), "Mozilla/5.0 Test");

    private static Task<NoteFusion.Shared.Results.Result> Save(TestHarness h, Guid userId, SaveWebPushSubscriptionCommand command)
        => new SaveWebPushSubscriptionCommandHandler(h.Db, h.Clock, new StubCurrentUser(userId), Keys(h)).Handle(command, default);

    private static async Task Subscribe(TestHarness h, Guid userId)
    {
        Assert.True((await Save(h, userId, Subscription())).IsSuccess);
        h.Db.ChangeTracker.Clear();
    }

    private static WebPushSender Sender(TestHarness h, HttpMessageHandler service, VapidKeys keys)
        => new(new HttpClient(service), h.Db, keys, h.Clock, NullLogger<WebPushSender>.Instance);

    private static async Task<User> SeedUser(TestHarness h, string email = "user@example.com")
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }

    private static byte[] PublicPoint(ECParameters p)
        => [0x04, .. p.Q.X!, .. p.Q.Y!];

    private static ECParameters PublicParameters(byte[] point) => new()
    {
        Curve = ECCurve.NamedCurves.nistP256,
        Q = new ECPoint { X = point[1..33], Y = point[33..65] },
    };

    /// <summary>The browser's side of RFC 8291: one aes128gcm record keyed from ECDH with the sender's key and the auth secret.</summary>
    private static string Decrypt(byte[] body)
    {
        var salt = body[..16];
        var idLength = body[20];
        var senderPublic = body[21..(21 + idLength)];
        var cipher = body[(21 + idLength)..];

        using var sender = ECDiffieHellman.Create(PublicParameters(senderPublic));
        var shared = Browser.DeriveRawSecretAgreement(sender.PublicKey);
        var browserPublic = Base64Url.DecodeFromChars(BrowserKey);
        byte[] keyInfo = [.. "WebPush: info\0"u8, .. browserPublic, .. senderPublic];
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, AuthSecret, keyInfo);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, "Content-Encoding: nonce\0"u8.ToArray());

        var plain = new byte[cipher.Length - 16];
        using var gcm = new AesGcm(cek, 16);
        gcm.Decrypt(nonce, cipher[..^16], cipher[^16..], plain);
        var end = Array.LastIndexOf(plain, (byte)0x02); // the last record's padding delimiter
        return Encoding.UTF8.GetString(plain, 0, end);
    }

    /// <summary>A push service that answers every POST with one status, keeping the exact bytes it was sent.</summary>
    private sealed class PushService(HttpStatusCode status) : HttpMessageHandler
    {
        public List<Captured> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            var headers = request.Headers.ToDictionary(x => x.Key, x => string.Join(",", x.Value), StringComparer.OrdinalIgnoreCase);
            Requests.Add(new Captured(
                request.Method, request.RequestUri!.ToString(), headers,
                string.Join(",", request.Content!.Headers.ContentEncoding),
                await request.Content.ReadAsByteArrayAsync(ct)));
            var response = new HttpResponseMessage(status);
            if (status == HttpStatusCode.TooManyRequests) response.Headers.RetryAfter = new(TimeSpan.FromSeconds(1));
            return response;
        }
    }

    private sealed record Captured(HttpMethod Method, string Uri, Dictionary<string, string> Headers, string ContentEncoding, byte[] Body);
}
