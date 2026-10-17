using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Practice.Reminders;

namespace NoteFusion.Infrastructure.Practice;

/// <summary>Registers the practice reminder sweep: its settings, the runner and the ten-minute worker.</summary>
public static class PracticeReminderDependencyInjection
{
    public static IServiceCollection AddPracticeReminders(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(ResolveSettings(configuration));
        services.AddScoped<PracticeReminderRunner>();
        services.AddHostedService<PracticeReminderWorker>();
        return services;
    }

    /// <summary>
    /// Read by hand rather than bound, like <c>OutreachDependencyInjection.ResolveSettings</c>: the deploy writes every
    /// variable whether or not it has a value, and an empty one must mean the default, not a binder error.
    /// </summary>
    public static PracticeReminderSettings ResolveSettings(IConfiguration configuration)
    {
        var section = configuration.GetSection("PracticeReminders");
        var defaults = new PracticeReminderSettings();
        return new PracticeReminderSettings
        {
            Enabled = !bool.TryParse(section["Enabled"], out var enabled) || enabled,
            IntervalMinutes = int.TryParse(section["IntervalMinutes"], out var minutes) && minutes > 0 ? minutes : defaults.IntervalMinutes,
            BatchSize = int.TryParse(section["BatchSize"], out var batch) && batch > 0 ? batch : defaults.BatchSize,
        };
    }
}
