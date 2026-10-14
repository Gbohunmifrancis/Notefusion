using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Geo;
using NoteFusion.Infrastructure.Media;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Infrastructure.Push.Workers;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Infrastructure.Transcriptions.Workers;

namespace NoteFusion.Infrastructure;

/// <summary>Registers Infrastructure services: persistence, security, push, email, media, and the transcription API client.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddSingleton<IWorkerHeartbeatTracker, NoteFusion.Infrastructure.Common.WorkerHeartbeatTracker>();
        services.AddPersistence(configuration);
        services.AddSecurity(configuration);
        services.AddPush(configuration);
        services.AddEmail(configuration);
        services.AddMedia(configuration);
        services.AddTranscriptionApi(configuration);
        services.AddBilling(configuration);
        services.AddGeo(configuration);

        return services;
    }

    private static void AddPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        var database = configuration
            .GetSection("Database")
            .Get<DatabaseSettings>() ?? new DatabaseSettings();
        services.AddSingleton(database);

        services.AddDbContext<ApplicationDbContext>(options =>
            options.UseNpgsql(ConnectionStringResolver.Resolve(database)));

        // Bridge the concrete context to the Application contract.
        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<ApplicationDbContext>());

        // The health probe takes the concrete context because it needs Database, which
        // IApplicationDbContext deliberately does not expose.
        services.AddScoped<IDatabaseHealth, DatabaseHealthProbe>();

        var seed = configuration.GetSection("Seed").Get<SeedSettings>() ?? new SeedSettings();
        services.AddSingleton(seed);

        services.AddHostedService<DatabaseSeeder>();
    }

    private static void AddSecurity(this IServiceCollection services, IConfiguration configuration)
    {
        var auth = configuration.GetSection("Auth").Get<AuthSettings>() ?? new AuthSettings();

        // A factory rather than the instance, because a deploy without Auth__DeletionSecret gets one derived
        // from the signing key, and the key only exists once the container builds it. Resolved once at
        // startup (Program.cs), so the warning is the first screen of logs rather than the first deletion.
        services.AddSingleton(sp =>
        {
            if (DeletionSecretFallback.Apply(auth, sp.GetRequiredService<RsaKeyProvider>()))
            {
                sp.GetRequiredService<ILoggerFactory>()
                    .CreateLogger(typeof(DeletionSecretFallback))
                    .LogWarning(
                        "Auth__DeletionSecret is not set (or is the published default); account-deletion links are " +
                        "signed with a secret derived from the JWT signing key. Set Auth__DeletionSecret to keep them independent.");
            }
            return auth;
        });

        var jwt = configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
        services.AddSingleton(jwt);
        services.AddSingleton<RsaKeyProvider>();

        var google = configuration.GetSection("Google").Get<GoogleSettings>() ?? new GoogleSettings();
        services.AddSingleton(google);

        services.AddSingleton<IDateTimeProvider, DateTimeProvider>();
        services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();
        services.AddSingleton<ISecureTokenGenerator, SecureTokenGenerator>();
        services.AddSingleton<IJwtTokenService, JwtTokenService>();

        // Singleton so the cached Google signing keys are shared: the validator's
        // ConfigurationManager refreshes the JWKS on its own schedule, and a per-request
        // instance would re-fetch the discovery document on every sign-in.
        services.AddSingleton<IGoogleTokenValidator, GoogleTokenValidator>();
    }

    private static void AddPush(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<IDeviceTokenService, DeviceTokenService>();

        // What the stores carry. Both build numbers default to zero, which means "announce nothing,
        // block nobody" — so a deploy that forgets AppRelease__LatestBuild is silent rather than wrong.
        var release = configuration.GetSection("AppRelease").Get<AppReleaseSettings>() ?? new AppReleaseSettings();
        services.AddSingleton(release);
        services.AddHostedService<AppUpdateNoticeWorker>();

        // Push provider: Expo in production, logging otherwise. The switch is a single DI line
        // (see IPushSender). Default to the logging sender so local/dev runs need no credentials.
        var useExpo = configuration.GetValue<bool?>("Push:UseExpo");
        if (useExpo == true)
        {
            services.AddHttpClient<IPushSender, ExpoPushSender>(client =>
                client.Timeout = TimeSpan.FromSeconds(10));
        }
        else
        {
            services.AddScoped<IPushSender, LoggingPushSender>();
        }
    }

    private static void AddEmail(this IServiceCollection services, IConfiguration configuration)
    {
        var email = EmailSettings.Resolve(configuration);
        services.AddSingleton(email);
        services.AddHostedService<EmailReadiness>();

        // The template is pure rendering over the settings, so one shared instance is enough.
        services.AddSingleton<BrandedEmailTemplate>();
        services.AddScoped<IEmailSender, EmailSender>();

        // Email provider mirrors the push switch: Resend in production, a logging sink otherwise, so a
        // local run needs no key and cannot mail a real person while sign-up is being tested. A key set
        // but UseResend still false stays in the log — turning it on is the deliberate step.
        if (email.UseResend)
        {
            services.AddHttpClient<IEmailTransport, ResendEmailTransport>(client =>
                client.Timeout = TimeSpan.FromSeconds(15));
        }
        else
        {
            services.AddScoped<IEmailTransport, LoggingEmailTransport>();
        }

        // Inbound email inbox — always registered; returns an empty list when no inbound route
        // is configured in Resend (so the page renders gracefully without crashing).
        services.AddHttpClient<IResendInboxService, ResendInboxService>(client =>
            client.Timeout = TimeSpan.FromSeconds(15));
    }

    private static void AddMedia(this IServiceCollection services, IConfiguration configuration)
    {
        var r2 = R2Settings.Resolve(configuration);
        services.AddSingleton(r2);
        services.AddHostedService<MediaReadiness>();

        // Same switch as email and push: the real provider only when it is turned on *and* fully
        // credentialled, a logging sink otherwise, so a local run needs no R2 bucket.
        // Singleton either way — the S3 client owns an HttpClient, and rebuilding one per
        // request is the socket-exhaustion mistake AddHttpClient exists to prevent.
        if (r2.IsConfigured)
        {
            services.AddSingleton<IImageStorage, R2ImageStorage>();
        }
        else
        {
            services.AddSingleton<IImageStorage, LoggingImageStorage>();
        }
    }

    private static void AddTranscriptionApi(this IServiceCollection services, IConfiguration configuration)
    {
        var baseUrl = configuration["TranscriptionApi:BaseUrl"] ?? "http://localhost:8000";
        var apiKey = configuration["TranscriptionApi:ApiKey"];

        // Transient, as AddHttpMessageHandler requires: the factory resolves one per handler chain it
        // builds, and a chain is rebuilt every two minutes.
        services.AddTransient<CorrelationIdHandler>();

        services.AddHttpClient<ITranscriptionApi, TranscriptionApiClient>(client =>
        {
            client.BaseAddress = new Uri(baseUrl);
            client.Timeout = TimeSpan.FromSeconds(100);
            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
            }
        })
        .AddHttpMessageHandler<CorrelationIdHandler>();

        // Watches jobs through to completion so a recording finishes whether or not the app is open.
        services.AddHostedService<TranscriptionCompletionWorker>();

        // Deletes web events and the transcription activity log after 180 days.
        services.AddHostedService<Activity.ActivityRetentionWorker>();

        // Keeps finished-but-unsaved sheets in the library and emails unfinished Pro checkouts.
        services.AddHostedService<Activity.RetentionSweepWorker>();
    }

    private static void AddGeo(this IServiceCollection services, IConfiguration configuration)
    {
        var geo = configuration.GetSection("Geo").Get<GeoSettings>() ?? new GeoSettings();
        services.AddSingleton(geo);

        // Same switch as email, push and media. The timeout is short by design: this runs inline on
        // sign-up, and a slow geolocation service must cost a new user three seconds at most — after
        // which they get an unknown country and every tier, which is a worse price for us and no worse
        // an experience for them.
        if (geo.IsConfigured)
        {
            services.AddHttpClient<IGeoIpLookup, HttpGeoIpLookup>(client =>
                client.Timeout = TimeSpan.FromSeconds(3));
        }
        else
        {
            services.AddScoped<IGeoIpLookup, DisabledGeoIpLookup>();
        }
    }
}
