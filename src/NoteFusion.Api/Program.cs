using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Models;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.Middleware;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure;
using NoteFusion.Infrastructure.Email;

// Load a local .env if present (dev convenience); real config comes from env vars in compose/prod.
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

// Configuration: environment variables (and an optional .env) override appsettings so the same
// image runs in dev and compose with only env changes.
builder.Configuration.AddEnvironmentVariables();

// The framework's own request pipeline narrates every request at Information — endpoint selected,
// route matched, action executed, result written — which is four lines of noise per call once they
// are JSON. appsettings.json used to hold this level, but that file is untracked now (it carried a
// live API key) and the environment cannot carry the replacement: a category-specific key is spelled
// Logging__LogLevel__Microsoft.AspNetCore, and the dot makes it an illegal variable name on a POSIX
// host, so the platform stores it and never hands it to the process. It belongs in code anyway — a
// log level is a policy, not a secret, and this way a fresh clone logs the same volume as this one.
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);

// Structured logs everywhere but a developer's terminal. The plain console formatter drops logging
// scopes entirely, which would throw away the correlation id CorrelationIdMiddleware puts there and
// leave the platform's log drain with prose to regex — the reason a failed job could not be found.
// ClearProviders first because CreateBuilder has already added the plain console; adding JSON without
// removing it prints every line twice.
if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(options =>
    {
        options.IncludeScopes = true;
        options.UseUtcTimestamp = true;
        options.TimestampFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    });
}

// Errors to Sentry, only when Sentry__Dsn is set (the "Sentry" section binds the rest: Sentry__Release is the
// deployed commit). Unhandled exceptions and LogError lines become events, Information lines their breadcrumbs.
// No request bodies, cookies or IP addresses (SendDefaultPii off), no headers or query strings and no email
// address anywhere (SentryScrub). The SDK sends from its own background queue and drops events when Sentry cannot be reached,
// so unlike the outside clients behind OutboundResilience it can never hold up a request.
if (!string.IsNullOrWhiteSpace(builder.Configuration["Sentry:Dsn"]))
{
    builder.WebHost.UseSentry(options =>
    {
        options.SendDefaultPii = false;
        options.MaxRequestBodySize = Sentry.Extensibility.RequestSize.None;
        options.SetBeforeSend((sentryEvent, _) => SentryScrub.Event(sentryEvent));
        options.SetBeforeBreadcrumb((breadcrumb, _) => SentryScrub.Breadcrumb(breadcrumb));
    });
}

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Ambient caller identity resolved from the JWT.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

// Ambient caller location, resolved from the forwarded chain. Registered here rather than in
// Infrastructure because reading it needs HttpContext, which Infrastructure has no reference to.
builder.Services.AddScoped<ICountryResolver, RequestCountryResolver>();

// Same seam, different question: the raw address, for the admin audit trail.
builder.Services.AddScoped<IClientIpAddress, RequestClientIpAddress>();

// Same seam again: which handset, for the free-trial ceiling. Per device rather than per account only,
// because a second Google account on the same phone was five more free generations.
builder.Services.AddScoped<IDeviceFingerprint, RequestDeviceFingerprint>();
builder.Services.AddScoped<IClientApp, RequestClientApp>();
builder.Services.AddScoped<IClientTimeZone, RequestClientTimeZone>();

// Same seam again, but singleton — see RequestCorrelationId for why the outbound HttpClient handler
// makes any shorter lifetime wrong.
builder.Services.AddSingleton<ICorrelationId, RequestCorrelationId>();

// Per-address limits on the anonymous auth routes.
builder.Services.AddNoteFusionRateLimiting(builder.Configuration);

// Heroku terminates TLS at its router and forwards the original scheme in a header; without this the
// app sees plain http for every request, which makes UseHttpsRedirection below an infinite redirect
// loop and any absolute URL it generates wrong.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // Proto only. X-Forwarded-For is deliberately NOT forwarded: this middleware would rewrite
    // RemoteIpAddress from the LEFTMOST entry, which is the one a caller can type, and both
    // ClientIpAddress.Resolve (billing tier) and AuthRateLimiting (per-caller limits) exist precisely to
    // read that chain from the right instead. Letting the framework overwrite the socket peer would
    // hand a spoofer the thing those two are guarding.
    options.ForwardedHeaders = ForwardedHeaders.XForwardedProto;

    // The default trusts loopback proxies only, and Heroku's router is not loopback, so the header
    // would be silently ignored. Clearing both is safe for Proto alone: the worst a forged
    // "X-Forwarded-Proto: https" achieves is skipping a redirect the caller was already speaking
    // https to avoid.
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// UseHttpsRedirection works out the port to redirect to from the app's own https endpoint, and this app
// has none: Heroku's Procfile binds `http://*:$PORT` and the router does the TLS. With no port found the
// middleware logs a warning and quietly forwards the request, so the redirect has to be told the public
// port or it does nothing at all — which is the failure that looks exactly like success.
builder.Services.AddHttpsRedirection(options => options.HttpsPort = 443);

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
    });

builder.Services.AddSignalR();
builder.Services.AddSingleton<Microsoft.AspNetCore.SignalR.IUserIdProvider, NoteFusion.Api.Hubs.SubClaimUserIdProvider>();
builder.Services.AddScoped<NoteFusion.Application.Common.Interfaces.ITranscriptionNotifier, NoteFusion.Api.Services.SignalRTranscriptionNotifier>();

// JWT auth — bearer options are configured against the shared RSA key (see ConfigureJwtBearerOptions).
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();
builder.Services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureJwtBearerOptions>();
builder.Services.AddAuthorization(options => options.AddNoteFusionPolicies());
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<UserAccessCache>();
builder.Services.AddSingleton<NoteFusion.Api.Blog.BlogReadsCache>();
builder.Services.AddScoped<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, CurrentAdminHandler>();
builder.Services.AddScoped<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, UnlockedPhoneHandler>();
builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationMiddlewareResultHandler, UnlockedPhoneResultHandler>();

// CORS for the browser clients on their own origins: the admin dashboard and, since the password-reset
// page moved onto the marketing site, notefusion.studio. Origins come from config
// (Cors__AllowedOrigins__0, __1, …) because the dev origin and the deployed one differ, and are listed
// explicitly rather than using AllowAnyOrigin so that a browser on an unknown site cannot read admin
// analytics. POST is needed for /api/auth/login and /api/auth/refresh, which the dashboard calls before
// it can read anything.
//
// The deployed origins below are added unconditionally, which means this policy does NOT fail closed on
// a misconfigured deploy — an earlier comment here claimed it did, and that was wrong. They stay because
// removing them takes the live console offline the moment Cors__AllowedOrigins is missing from Heroku
// config; the localhost pair is the part that had no business being reachable in production, so that is
// what is now gated. Compose runs Production and passes localhost:3000 through
// Cors__AllowedOrigins__0, which is the intended route for it.
var allowedOriginsArray = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
var rawAllowedOrigins = builder.Configuration["Cors:AllowedOrigins"]
    ?? builder.Configuration["Cors__AllowedOrigins"]
    ?? string.Empty;

var parsedFromRaw = rawAllowedOrigins.Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
var originsSet = new HashSet<string>(allowedOriginsArray.Concat(parsedFromRaw), StringComparer.OrdinalIgnoreCase);

if (builder.Environment.IsDevelopment())
{
    // The admin console's Next dev server, which defaults to port 3000. Development only: in
    // production this is an origin an attacker controls, because anything running on the victim's
    // own machine can claim it. 5173 was the console's port while it was a Vite app; nothing in the
    // repo serves on it now, and it stays only because appsettings.Development.json still lists it.
    originsSet.Add("http://localhost:3000");
    originsSet.Add("http://127.0.0.1:3000");
    originsSet.Add("http://localhost:5173");
    originsSet.Add("http://127.0.0.1:5173");
}

originsSet.Add("https://notefusion.studio");
// The admin dashboard's own subdomain. It is a separate origin from the marketing site, so
// listing the apex is not enough — without this line every call from the console is blocked.
originsSet.Add("https://admin.notefusion.studio");
originsSet.Add("https://notefusion-web.vercel.app");
// Vercel's generated alias for the dashboard project. `<project>.vercel.app` was already taken
// globally, so the production URL carries a random suffix — it is the origin the browser actually
// sends, and it is stable for the life of the project.
originsSet.Add("https://web-admin-blue-two.vercel.app");
originsSet.Add("https://notefusion-privacy.vercel.app");

var allowedOrigins = originsSet.ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy(AdminDashboardCorsPolicy, policy =>
    {
        // The list above, plus any https *.vercel.app origin: Vercel gives every preview deploy its own
        // hostname, and those are where web changes are checked before they ship. Credentials are not
        // allowed, so a matching origin can call the API only with a token it already holds.
        policy.SetIsOriginAllowed(origin => IsAllowedOrigin(origin, allowedOrigins))
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "NoteFusion Web API",
        Version = "v1",
        Description = "API gateway for NoteFusion — live & recorded music transcription into Tonic Solfa + staff notation."
    });

    var xmlFilename = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFilename);
    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath);
    }

    var scheme = new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter JWT Bearer token",
        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
    };
    options.AddSecurityDefinition("Bearer", scheme);
    options.AddSecurityRequirement(new OpenApiSecurityRequirement { [scheme] = Array.Empty<string>() });
});

var app = builder.Build();

// Resolved now rather than on the first sign-in, so a deploy without its own Auth__DeletionSecret says so
// in the startup logs (see DeletionSecretFallback).
app.Services.GetRequiredService<NoteFusion.Application.Common.Settings.AuthSettings>();
// Likewise the web push key pair: the startup log says whether it is configured, derived or off.
app.Services.GetRequiredService<NoteFusion.Infrastructure.Push.VapidKeys>();

// Before anything reads the scheme — HSTS, the HTTPS redirect, any absolute URL. Rewrites
// Request.Scheme from X-Forwarded-Proto (see the options above for what it deliberately does not touch).
app.UseForwardedHeaders();

// Outside the error boundary on purpose: the 500 that boundary logs is the line most worth being able to
// find, and a scope opened downstream of it would not cover it.
app.UseMiddleware<CorrelationIdMiddleware>();

// Hardening headers on every response, error responses included, so it sits outside the error boundary.
app.UseMiddleware<SecurityHeadersMiddleware>();

// Terminal error boundary — wraps everything below.
app.UseMiddleware<ExceptionHandlingMiddleware>();

// TLS. Both are skipped in Development (no local certificate) and can be switched off with
// Security__RequireHttps=false — which docker-compose does, because that stack speaks plain HTTP end to
// end with no TLS terminator in front of it, and a redirect there points at a port nothing is listening
// on. On Heroku the router terminates TLS, so this depends entirely on UseForwardedHeaders above having
// seen X-Forwarded-Proto: if it has not, every request redirects to itself. That is the one failure mode
// worth knowing about here, and `heroku config:set Security__RequireHttps=false` is the way out of it.
var requireHttps = !app.Environment.IsDevelopment()
    && app.Configuration.GetValue("Security:RequireHttps", true);

if (requireHttps)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// Swagger is a full description of every route and DTO in the product, so it is opt-in rather than
// always-on: it was unconditional here, which published the surface of the admin routes to anyone who
// asked. On by default in Development; elsewhere it needs Swagger__Enabled=true, which docker-compose
// sets because its own comments send you to /swagger.
if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Swagger:Enabled", false))
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "NoteFusion API v1");
        options.RoutePrefix = "swagger";
        options.DocumentTitle = "NoteFusion API Documentation";
    });
}

// Explicit, because UseRateLimiter needs endpoint metadata to know which policy an [EnableRateLimiting]
// route asked for, and that is only resolved once routing has run.
app.UseRouting();

// CORS sits before auth so a preflight, which carries no Authorization header, gets its headers
// back instead of a 401 the browser would report as an opaque CORS failure.
app.UseCors(AdminDashboardCorsPolicy);

// Read-only while the service moves to another server or provider (Maintenance__ReadOnly). After CORS, so
// the browser can read the 503's explanation; before everything else, so no write gets as far as a handler.
if (MaintenanceModeMiddleware.IsEnabled(app.Configuration))
{
    app.Logger.LogWarning("Maintenance read-only mode is ON: every write is refused with 503 until Maintenance__ReadOnly is unset.");
    app.UseMiddleware<MaintenanceModeMiddleware>();
}

// After CORS, for the same reason: a 429 with no CORS headers reaches the admin console as an opaque
// network error, so the one message that explains itself — "try again in 5 minutes" — would be the one
// message the browser refuses to hand over.
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

// After authorization, so it sees who is signed in; it stamps last-seen once the response is done.
app.UseMiddleware<LastSeenMiddleware>();
// Likewise: the account's time zone, written when the client's X-Time-Zone changes (the practice reminders read it).
app.UseMiddleware<ClientTimeZoneMiddleware>();

app.MapControllers();
app.MapHub<NoteFusion.Api.Hubs.TranscriptionHub>("/hubs/transcription");

// Serve the email logo directly with long-lived public caching. This guarantees instant delivery
// and backwards compatibility for existing mail clients requesting {BaseUrl}/email/logo.png.
app.MapGet("/email/logo.png", (HttpContext context) =>
{
    context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
    return Results.File(EmailLogoAsset.Bytes, "image/png");
}).AllowAnonymous();

app.Run();

/// <summary>Exposed so the integration-test host (WebApplicationFactory) can reference the entry point.</summary>
public partial class Program
{
    /// <summary>Name of the CORS policy applied to the whole app for the admin dashboard's origin.</summary>
    public const string AdminDashboardCorsPolicy = "AdminDashboard";

    /// <summary>
    /// Whether a browser on <paramref name="origin"/> may call the API: one of <paramref name="allowedOrigins"/>
    /// exactly, or an https origin on a <c>.vercel.app</c> subdomain (preview deploys).
    /// </summary>
    internal static bool IsAllowedOrigin(string origin, IReadOnlyCollection<string> allowedOrigins)
    {
        if (allowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
            return true;

        return Uri.TryCreate(origin, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps
            && uri.IsDefaultPort
            && uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase);
    }
}
