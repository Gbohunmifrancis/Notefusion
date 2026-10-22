using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Infrastructure.Blog;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.ErrorReports;
using NoteFusion.Infrastructure.Geo;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Infrastructure.Media;
using NoteFusion.Infrastructure.Offers;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Infrastructure.Practice;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Infrastructure.Push.Workers;
using NoteFusion.Infrastructure.Security;
using NoteFusion.Infrastructure.Security.Passkeys;
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
        // One per process: the lock table must be shared by every request (see InProcessQuotaGate on scale-out).
        services.AddSingleton<IQuotaGate, NoteFusion.Infrastructure.Common.InProcessQuotaGate>();
        // Every outside HTTP client gets OutboundResilience; this is the breaker state the batches read.
        services.AddProviderHealth();
        services.AddPersistence(configuration);
        services.AddSecurity(configuration);
        services.AddPush(configuration);
        services.AddEmail(configuration);
        services.AddMedia(configuration);
        services.AddTranscriptionApi(configuration);
        services.AddBilling(configuration);
        services.AddGeo(configuration);
        services.AddOutreach(configuration);
        services.AddOffers(configuration);
        services.AddPracticeReminders(configuration);
        services.AddPracticeModes(configuration);
        services.AddBlog(configuration);
        services.AddSentrySessions(configuration);

        // The backups run in their own container (ops/backup); the API reads what they record, shows it on
        // System Health and alerts the admins when they fall behind.
        services.AddSingleton(configuration.GetSection("Backups").Get<BackupSettings>() ?? new BackupSettings());
        services.AddHostedService<Monitoring.BackupAlertWorker>();

        return services;
    }

    private static void AddPersistence(this IServiceCollection services, IConfiguration configuration)
    {
        var database = configuration
            .GetSection("Database")
            .Get<DatabaseSettings>() ?? new DatabaseSettings();
        services.AddSingleton(database);

        // The loops that work saved rows are rung as the rows are saved (WorkSignalInterceptor).
        services.AddSingleton<Common.WorkSignals>();
        services.AddSingleton<WorkSignalInterceptor>();
        // A deleted sheet's (or closed account's) backings are deleted from the file store as the delete commits.
        services.AddSingleton<BackingCleanupInterceptor>();
        services.AddDbContext<ApplicationDbContext>((sp, options) => options
            .UseNpgsql(ConnectionStringResolver.Resolve(database))
            .AddInterceptors(
                sp.GetRequiredService<WorkSignalInterceptor>(),
                sp.GetRequiredService<BackingCleanupInterceptor>()));

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

        // Passkeys for the admin console (WebAuthn, Fido2NetLib). The relying party has working defaults;
        // Development gets rpId "localhost" and the console's dev origin.
        services.AddSingleton(sp =>
        {
            var settings = PasskeySettings.Resolve(
                configuration, sp.GetRequiredService<IHostEnvironment>().IsDevelopment());
            foreach (var origin in settings.OriginsOutsideRpId())
            {
                sp.GetRequiredService<ILoggerFactory>()
                    .CreateLogger(typeof(PasskeySettings))
                    .LogWarning(
                        "Passkeys__Origins lists {Origin}, which is not under Passkeys__RpId {RpId}; browsers there will refuse passkeys.",
                        origin, settings.RpId);
            }
            return settings;
        });
        services.AddSingleton<IPasskeyCeremony, Fido2PasskeyCeremony>();
        services.AddSingleton<IPasskeyChallengeStore, InMemoryPasskeyChallengeStore>();
        // The phone admin lock's codes and passes (one instance, like the challenges above).
        services.AddSingleton<IAdminPhoneLock, InMemoryAdminPhoneLock>();
        // Live job updates for the clients watching a job (one instance, like the above).
        services.AddSingleton<IJobEvents, Transcriptions.InMemoryJobEvents>();
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
            // Push__ExpoAccessToken only once enhanced push security is on for the Expo project.
            services.AddSingleton(configuration.GetSection("Push").Get<ExpoPushSettings>() ?? new ExpoPushSettings());
            services.AddSingleton<PushTicketLog>();
            services.AddHttpClient<IPushSender, ExpoPushSender>()
                .AddOutboundResilience(OutboundResilience.Push);
            // What Google or Apple did with each push Expo took: read by the worker, and by the test alert.
            services.AddHttpClient<IPushReceipts, ExpoPushReceipts>()
                .AddOutboundResilience(OutboundResilience.PushReceipts);
            services.AddHostedService<PushReceiptWorker>();
        }
        else
        {
            services.AddScoped<IPushSender, LoggingPushSender>();
            services.AddSingleton<IPushReceipts, NoPushReceipts>();
        }

        // "Someone signed up" / "someone is transcribing" on the admins' phones; AdminActivityAlerts__Enabled=false is off.
        if (configuration.GetValue("AdminActivityAlerts:Enabled", true))
            services.AddHostedService<AdminActivityAlertWorker>();

        // Web push for the web app: the VAPID pair is configured or derived from the JWT signing key
        // (see VapidKeys), so it needs no setup; WebPush__Enabled=false turns it off.
        var webPush = configuration.GetSection("WebPush").Get<WebPushSettings>() ?? new WebPushSettings();
        services.AddSingleton(sp => VapidKeys.Resolve(
            webPush,
            sp.GetRequiredService<RsaKeyProvider>(),
            sp.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(VapidKeys))));
        services.AddSingleton<IWebPushKeys>(sp => sp.GetRequiredService<VapidKeys>());
        services.AddHttpClient<IWebPushSender, WebPushSender>()
            // The default request log line carries the URL, and an endpoint is a browser's private address.
            .RemoveAllLoggers()
            .AddOutboundResilience(OutboundResilience.WebPush);
    }

    private static void AddEmail(this IServiceCollection services, IConfiguration configuration)
    {
        var email = EmailSettings.Resolve(configuration);
        services.AddSingleton(email);
        services.AddHostedService<EmailReadiness>();

        // The template is pure rendering over the settings, so one shared instance is enough.
        services.AddSingleton<BrandedEmailTemplate>();
        services.AddScoped<IEmailSender, EmailSender>();

        // The provider's daily/monthly caps: optional mail waits when they are nearly used (EmailBudget).
        services.AddSingleton(EmailSettings.ResolveQuota(configuration));
        services.AddScoped<IEmailQuota, EmailQuota>();

        // Email provider mirrors the push switch: Resend in production, a logging sink otherwise, so a
        // local run needs no key and cannot mail a real person while sign-up is being tested. A key set
        // but UseResend still false stays in the log — turning it on is the deliberate step.
        if (email.UseResend)
        {
            services.AddHttpClient<IEmailTransport, ResendEmailTransport>()
                .AddOutboundResilience(OutboundResilience.Email);
        }
        else
        {
            services.AddScoped<IEmailTransport, LoggingEmailTransport>();
        }

        // Inbound email inbox — always registered; returns an empty list when no inbound route
        // is configured in Resend (so the page renders gracefully without crashing).
        services.AddHttpClient<IResendInboxService, ResendInboxService>()
            .AddOutboundResilience(OutboundResilience.EmailInbox);
        // The sent mail's log, for the console's Sent mail: the same reads-only pipeline.
        services.AddHttpClient<ISentMailService, ResendSentMailService>()
            .AddOutboundResilience(OutboundResilience.EmailInbox);
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

            // The backings kept with sheets, in the same bucket, through the shared resilience pipeline.
            services.AddHttpClient(R2BackingStorage.HttpClientName).AddOutboundResilience(OutboundResilience.FileStore);
            services.AddSingleton<IBackingStorage, R2BackingStorage>();
        }
        else
        {
            services.AddSingleton<IImageStorage, LoggingImageStorage>();
            services.AddSingleton<IBackingStorage, LoggingBackingStorage>();
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
            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
            }
        })
        .AddHttpMessageHandler<CorrelationIdHandler>()
        .AddOutboundResilience(OutboundResilience.Transcription);

        // The practice graders are the same worker client: its key, correlation id, timeouts and breaker.
        services.AddTransient<IPracticeAudioApi>(sp => (IPracticeAudioApi)sp.GetRequiredService<ITranscriptionApi>());

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
        // an experience for them. Its breaker stops even those three seconds while it is down.
        if (geo.IsConfigured)
        {
            services.AddHttpClient<IGeoIpLookup, HttpGeoIpLookup>()
                .AddOutboundResilience(OutboundResilience.GeoIp);
        }
        else
        {
            services.AddScoped<IGeoIpLookup, DisabledGeoIpLookup>();
        }
    }
}
