using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Infrastructure.Persistence;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Infrastructure.Security;

namespace NoteFusion.Infrastructure;

/// <summary>Registers Infrastructure services: persistence, security, push, and the transcription API client.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddPersistence(configuration);
        services.AddSecurity(configuration);
        services.AddPush(configuration);
        services.AddTranscriptionApi(configuration);

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

        var seed = configuration.GetSection("Seed").Get<SeedSettings>() ?? new SeedSettings();
        services.AddSingleton(seed);

        services.AddHostedService<DatabaseSeeder>();
    }

    private static void AddSecurity(this IServiceCollection services, IConfiguration configuration)
    {
        var auth = configuration.GetSection("Auth").Get<AuthSettings>() ?? new AuthSettings();
        services.AddSingleton(auth);

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

    private static void AddTranscriptionApi(this IServiceCollection services, IConfiguration configuration)
    {
        var baseUrl = configuration["TranscriptionApi:BaseUrl"] ?? "http://localhost:8000";
        services.AddHttpClient<ITranscriptionApi, TranscriptionApiClient>(client =>
        {
            client.BaseAddress = new Uri(baseUrl);
            client.Timeout = TimeSpan.FromSeconds(100);
        });
    }
}
