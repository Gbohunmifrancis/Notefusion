using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Outreach;

namespace NoteFusion.Infrastructure.Outreach;

/// <summary>Registers the founder's customer-research outreach: settings, unsubscribe links, the hourly worker.</summary>
public static class OutreachDependencyInjection
{
    public static IServiceCollection AddOutreach(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(ResolveSettings(configuration));
        services.AddSingleton<IEmailUnsubscribeTokens, HmacEmailUnsubscribeTokens>();
        services.AddScoped<OutreachRunner>();
        services.AddHostedService<OutreachWorker>();
        return services;
    }

    /// <summary>
    /// Read by hand rather than bound, like <c>EmailSettings.Resolve</c>: the deploy writes every variable
    /// whether or not its value exists, so an unset one arrives as "", which the binder refuses for a bool or
    /// an int and would write over a default.
    /// </summary>
    public static OutreachSettings ResolveSettings(IConfiguration configuration)
    {
        var section = configuration.GetSection("Outreach");
        var defaults = new OutreachSettings();
        return new OutreachSettings
        {
            Enabled = bool.TryParse(section["Enabled"], out var enabled) && enabled,
            FounderName = section["FounderName"]?.Trim() ?? string.Empty,
            ReplyTo = section["ReplyTo"]?.Trim() ?? string.Empty,
            BatchSize = int.TryParse(section["BatchSize"], out var batch) && batch > 0 ? batch : defaults.BatchSize,
            IntervalMinutes = int.TryParse(section["IntervalMinutes"], out var minutes) && minutes > 0
                ? minutes
                : defaults.IntervalMinutes,
            ApiBaseUrl = string.IsNullOrWhiteSpace(section["ApiBaseUrl"])
                ? defaults.ApiBaseUrl
                : section["ApiBaseUrl"]!.Trim(),
        };
    }
}
