using System.Globalization;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using NoteFusion.Api.Common;

namespace NoteFusion.Api.RateLimiting;

/// <summary>
/// Per-caller limits on the anonymous auth endpoints — the only routes in this API that a stranger can
/// call in a loop and get something out of.
/// </summary>
/// <remarks>
/// <para>
/// Three distinct abuses, so three policies rather than one number: guessing a secret
/// (<see cref="Credentials"/>), making us send mail to somebody (<see cref="EmailDispatch"/>), and
/// minting accounts for the free transcription grant each one carries (<see cref="Registration"/>). A
/// single shared limit would have to be as loose as the most chatty of the three, which is login, and
/// that is the one where volume is the attack. Two looser ones sit beside them: token refresh
/// (<see cref="TokenRefresh"/>), which every signed-in client calls, and the site's analytics beacon
/// (<see cref="WebEvents"/>), which writes a row per event for anyone who calls it.
/// </para>
/// <para>
/// Every limit is per-address and configurable (<c>RateLimit__*</c>), because the right number depends on
/// how many real users sit behind one address in the market being served, and that is not something to
/// find out by shipping a code change. Setting <c>RateLimit__Enabled=false</c> turns the whole thing off.
/// </para>
/// </remarks>
public static class AuthRateLimiting
{
    /// <summary>Endpoints where the caller is guessing at a secret: login, a six-digit code, a reset token.</summary>
    public const string Credentials = "auth-credentials";

    /// <summary>Endpoints that make us send an email to an address the caller chose.</summary>
    public const string EmailDispatch = "auth-email";

    /// <summary>Account creation, which hands out the free transcription grant.</summary>
    public const string Registration = "auth-registration";

    /// <summary>Refresh-token rotation, which every signed-in client calls on a schedule.</summary>
    public const string TokenRefresh = "auth-refresh";

    /// <summary>The website's anonymous analytics beacon, which writes a row per event.</summary>
    public const string WebEvents = "web-events";

    /// <summary>The blog's read counts: a database count anyone can ask for, cached per page.</summary>
    public const string BlogReads = "blog-reads";

    /// <summary>
    /// Passkey steps that guess at nothing: minting a challenge (the console's sign-in page asks for one on
    /// every load, to offer passkeys in the email field's autofill) and an admin storing a passkey. Apart from
    /// <see cref="Credentials"/> so opening the sign-in page a few times cannot use up password attempts.
    /// </summary>
    public const string Passkeys = "auth-passkeys";

    /// <summary>
    /// Asking how long a linked song is (<c>…/link/info</c>, signed in or a website preview): each one has the
    /// worker ask YouTube, so a loop over fresh ids would burn its CPU and get its address blocked for everyone.
    /// </summary>
    public const string LinkInfo = "link-info";

    /// <summary>Opening, confirming and leaving a checkout: each one asks the payment provider.</summary>
    public const string Billing = "billing";

    public static IServiceCollection AddNoteFusionRateLimiting(
        this IServiceCollection services, IConfiguration configuration)
    {
        var configured = configuration.GetSection("RateLimit").Get<RateLimitSettings>() ?? new RateLimitSettings();

        // Turning it off still registers every policy: an [EnableRateLimiting] attribute naming a
        // policy that does not exist throws at the first request, so removing the limiter has to leave the
        // names resolvable. An unreachable permit count is what "off" looks like.
        var settings = configured.Enabled ? configured : configured.Disabled();
        services.AddSingleton(settings);

        // "Hum to find a hymn" counts per address AND per device, by the minute and by the day: four buckets
        // where a policy has one, so it is a filter of its own (HymnIdentifyRateLimiting.cs).
        services.AddSingleton<HymnIdentifyLimiter>();
        // Marking a daily drill: per device and per address, beside the account's own day allowance.
        services.AddSingleton<PracticeDrillLimiter>();

        services.AddRateLimiter(options =>
        {
            options.AddPolicy(Credentials, context => SlidingWindow(
                context, settings, settings.CredentialsPermits, settings.CredentialsWindowSeconds));

            options.AddPolicy(EmailDispatch, context => SlidingWindow(
                context, settings, settings.EmailPermits, settings.EmailWindowSeconds));

            options.AddPolicy(Registration, context => SlidingWindow(
                context, settings, settings.RegistrationPermits, settings.RegistrationWindowSeconds));

            options.AddPolicy(TokenRefresh, context => SlidingWindow(
                context, settings, settings.RefreshPermits, settings.RefreshWindowSeconds));

            options.AddPolicy(WebEvents, context => SlidingWindow(
                context, settings, settings.WebEventsPermits, settings.WebEventsWindowSeconds));

            options.AddPolicy(BlogReads, context => SlidingWindow(
                context, settings, settings.BlogReadsPermits, settings.BlogReadsWindowSeconds));

            options.AddPolicy(Passkeys, context => SlidingWindow(
                context, settings, settings.PasskeyPermits, settings.PasskeyWindowSeconds));

            options.AddPolicy(LinkInfo, context => SlidingWindow(
                context, settings, settings.LinkInfoPermits, settings.LinkInfoWindowSeconds));

            options.AddPolicy(Billing, context => SlidingWindow(
                context, settings, settings.BillingPermits, settings.BillingWindowSeconds));

            options.OnRejected = (context, cancellationToken) => new ValueTask(WriteRejectedAsync(
                context.HttpContext, context.Lease, seconds => $"Too many attempts from this device. Try again in {Describe(seconds)}.",
                cancellationToken));
        });

        return services;
    }

    /// <summary>The 429 every limit here answers with: a <c>Retry-After</c> and the usual error envelope.</summary>
    internal static async Task WriteRejectedAsync(
        HttpContext context, RateLimitLease lease, Func<int, string> message, CancellationToken cancellationToken)
    {
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;

        // The window, not the time to the next free permit — the limiter does not expose the
        // latter. Erring long is the right direction: a client that waits the whole window is
        // certain to be let through, and one that retries early gets another 429, not a lockout.
        var seconds = lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))
            : 60;

        context.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);

        // Same envelope as every other failure this API returns, so a client that already knows
        // how to read an error does not need a second code path for this one. Wording is
        // deliberately incurious about which limit was hit: naming the policy would tell an
        // attacker which of the policies they tripped.
        await context.Response.WriteAsJsonAsync(new ApiError("RATE_LIMITED", message(seconds)), cancellationToken);
    }

    internal static RateLimitPartition<string> SlidingWindow(
        HttpContext context, RateLimitSettings settings, int permits, int windowSeconds)
        => RateLimitPartition.GetSlidingWindowLimiter(
            PartitionKey(context, settings.TrustedProxyHops),
            _ => new SlidingWindowRateLimiterOptions
            {
                PermitLimit = permits,
                Window = TimeSpan.FromSeconds(windowSeconds),
                // Sliding rather than fixed because a fixed window lets a caller spend the whole allowance
                // at the end of one window and again at the start of the next — 2x the stated limit in a
                // burst, and the burst is the attack. Four segments means the allowance decays in
                // quarter-window steps instead of all at once.
                SegmentsPerWindow = 4,
                // Nothing queues. A rejected caller wants the 429 now; holding the request open to release
                // it later spends a connection on somebody who is, by hypothesis, calling too often.
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            });

    /// <summary>
    /// Which bucket this request counts against: the caller's address, as far as it can be established.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Reads the forwarded chain from the RIGHT for the same reason
    /// <c>ClientIpAddress.Resolve</c> does — each hop appends, so the leftmost entry is whatever the
    /// caller typed, and partitioning on that would let one attacker mint a fresh bucket per request by
    /// varying a header.
    /// </para>
    /// <para>
    /// It deliberately does <b>not</b> reuse that method. <c>Resolve</c> discards any address that is not
    /// publicly routable, carrier-grade NAT included, because an address shared between subscribers
    /// identifies nobody and so cannot pick a billing tier. Here the opposite is true: a CGNAT address is
    /// the finest distinction available for a mobile subscriber, and collapsing every one of them into a
    /// single null bucket would let one abuser lock out an entire mobile network. Non-routable is kept;
    /// only genuinely absent is pooled, under a name that says so.
    /// </para>
    /// </remarks>
    internal static string PartitionKey(HttpContext context, int trustedProxyHops)
    {
        if (trustedProxyHops > 0)
        {
            var chain = context.Request.Headers["X-Forwarded-For"].ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (chain.Length >= trustedProxyHops)
                return Normalise(chain[^trustedProxyHops]) ?? "unknown";
        }

        return Normalise(context.Connection.RemoteIpAddress?.ToString()) ?? "unknown";
    }

    /// <summary>
    /// One chain entry reduced to a bare address, or null if it is not one. Brackets and ports are
    /// stripped so <c>1.2.3.4:5678</c> and <c>1.2.3.4</c> cannot become two buckets for one caller.
    /// </summary>
    private static string? Normalise(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return null;

        var value = candidate.Trim();

        if (value.StartsWith('['))
        {
            var close = value.IndexOf(']');
            if (close < 0) return null;
            value = value[1..close];
        }
        else if (value.Count(c => c == ':') == 1)
        {
            value = value[..value.IndexOf(':')];
        }

        if (!IPAddress.TryParse(value, out var ip))
            return null;

        if (ip.IsIPv4MappedToIPv6)
            return ip.MapToIPv4().ToString();

        // One IPv6 subscriber is handed a whole /64, so a bucket per address would give them 2^64 buckets.
        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            var bytes = ip.GetAddressBytes();
            Array.Clear(bytes, 8, 8);
            return new IPAddress(bytes) + "/64";
        }

        return ip.ToString();
    }

    /// <summary>
    /// The wait, as a person says it: seconds, then minutes, then hours, so a daily limit reads "Try again in
    /// 9 hours" rather than "in 540 minutes".
    /// </summary>
    internal static string Describe(int seconds)
    {
        if (seconds < 90) return $"{seconds} seconds";
        var minutes = (int)Math.Ceiling(seconds / 60.0);
        return minutes < 90 ? $"{minutes} minutes" : $"{(int)Math.Ceiling(minutes / 60.0)} hours";
    }
}

/// <summary>Limits for <see cref="AuthRateLimiting"/>, bound from the <c>RateLimit</c> configuration section.</summary>
public sealed class RateLimitSettings
{
    /// <summary>Master switch. Off leaves the policies registered but effectively unlimited.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// How many hops append to <c>X-Forwarded-For</c> between the caller and this process. One for
    /// Heroku's router. Mirrors <c>Geo__TrustedProxyHops</c>, and is a separate setting only so that
    /// tightening one cannot silently move the other.
    /// </summary>
    public int TrustedProxyHops { get; set; } = 1;

    /// <summary>
    /// Login, email verification and password reset. Fifteen a minute is far above a person mistyping a
    /// password and far below a list being worked through.
    /// </summary>
    public int CredentialsPermits { get; set; } = 15;

    public int CredentialsWindowSeconds { get; set; } = 60;

    /// <summary>
    /// Forgot-password and resend-verification. Low, because each one sends mail to an address the caller
    /// chose: the cost of getting this wrong is a stranger's inbox and our sending reputation, and a real
    /// user needs one or two.
    /// </summary>
    public int EmailPermits { get; set; } = 5;

    public int EmailWindowSeconds { get; set; } = 900;

    /// <summary>
    /// Sign-ups. Each account carries free transcriptions, so bulk registration is a way of buying
    /// nothing. Ten an hour leaves room for a shared address — a classroom, an office — while making a
    /// farm of throwaway accounts slow enough to be visible.
    /// </summary>
    public int RegistrationPermits { get; set; } = 10;

    public int RegistrationWindowSeconds { get; set; } = 3600;

    /// <summary>
    /// Token refresh. A client refreshes about once an access-token lifetime and again on a 401, but a mobile
    /// carrier puts many phones behind one address, so 120 a minute leaves a crowded address plenty of room
    /// while still capping how fast stolen or guessed tokens can be tried — each attempt is a bcrypt verify.
    /// </summary>
    public int RefreshPermits { get; set; } = 120;

    public int RefreshWindowSeconds { get; set; } = 60;

    /// <summary>
    /// The site's analytics beacon. The tracker batches, so a busy reader sends a handful a minute; sixty is
    /// room for several tabs and a shared address, and a ceiling on how fast anyone can fill the table.
    /// </summary>
    public int WebEventsPermits { get; set; } = 60;

    public int WebEventsWindowSeconds { get; set; } = 60;

    /// <summary>
    /// The blog's read counts. A page asks once as it loads, so a reader sends one a page; a hundred and twenty
    /// a minute is room for a mobile carrier's shared address and a ceiling on anyone polling the counts.
    /// </summary>
    public int BlogReadsPermits { get; set; } = 120;

    public int BlogReadsWindowSeconds { get; set; } = 60;

    /// <summary>
    /// Passkey challenges and passkey storage. Each is a few random bytes in memory or an admin's own write,
    /// so sixty a minute is room for a shared address and a ceiling on anyone filling the challenge store.
    /// </summary>
    public int PasskeyPermits { get; set; } = 60;

    public int PasskeyWindowSeconds { get; set; } = 60;

    /// <summary>Linked-song lookups: a person checks a song or two before choosing a section.</summary>
    public int LinkInfoPermits { get; set; } = 20;

    public int LinkInfoWindowSeconds { get; set; } = 60;

    /// <summary>Checkout, confirm and leave: a buyer makes a handful; each is a call to the payment provider.</summary>
    public int BillingPermits { get; set; } = 30;

    public int BillingWindowSeconds { get; set; } = 60;

    /// <summary>
    /// "Hum to find a hymn", per address and per device alike: a few tries a minute (a visitor humming a tune
    /// again, more slowly, is the expected use) and a day's ceiling, since every try is a second of the
    /// worker's CPU and the page is open to anyone.
    /// </summary>
    public int HymnIdentifyPermits { get; set; } = 5;

    public int HymnIdentifyWindowSeconds { get; set; } = 60;

    public int HymnIdentifyDailyPermits { get; set; } = 20;

    public int HymnIdentifyDailyWindowSeconds { get; set; } = 86_400;

    /// <summary>
    /// Daily drills marked from one device: a few a minute (a retry, a second go) and a day's ceiling above Pro's
    /// twenty, so a family sharing a phone is never the one refused. Every try is a second of the worker's CPU.
    /// </summary>
    public int PracticeDrillPermits { get; set; } = 6;

    public int PracticeDrillWindowSeconds { get; set; } = 60;

    public int PracticeDrillDeviceDailyPermits { get; set; } = 40;

    /// <summary>Daily drills marked from one address, loose because a mobile carrier puts many phones behind one.</summary>
    public int PracticeDrillAddressDailyPermits { get; set; } = 200;

    /// <summary>A copy with every limit effectively removed, used when <see cref="Enabled"/> is false.</summary>
    internal RateLimitSettings Disabled() => new()
    {
        Enabled = false,
        TrustedProxyHops = TrustedProxyHops,
        CredentialsPermits = int.MaxValue,
        EmailPermits = int.MaxValue,
        RegistrationPermits = int.MaxValue,
        RefreshPermits = int.MaxValue,
        WebEventsPermits = int.MaxValue,
        BlogReadsPermits = int.MaxValue,
        PasskeyPermits = int.MaxValue,
        LinkInfoPermits = int.MaxValue,
        BillingPermits = int.MaxValue,
        HymnIdentifyPermits = int.MaxValue,
        HymnIdentifyDailyPermits = int.MaxValue,
        PracticeDrillPermits = int.MaxValue,
        PracticeDrillDeviceDailyPermits = int.MaxValue,
        PracticeDrillAddressDailyPermits = int.MaxValue,
    };
}
