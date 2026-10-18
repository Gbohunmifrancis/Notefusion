using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Practice.Modes;

namespace NoteFusion.Infrastructure.Practice;

/// <summary>Registers the practice modes' switches (<see cref="PracticeModeSettings"/>, section <c>PracticeModes</c>).</summary>
public static class PracticeModeDependencyInjection
{
    public static IServiceCollection AddPracticeModes(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(ResolveSettings(configuration));
        return services;
    }

    /// <summary>
    /// Read by hand, like <see cref="PracticeReminderDependencyInjection.ResolveSettings"/>: a variable the deploy writes
    /// empty means the default (on); only "false" switches a mode off.
    /// </summary>
    public static PracticeModeSettings ResolveSettings(IConfiguration configuration)
    {
        var section = configuration.GetSection("PracticeModes");
        bool On(string name) => !bool.TryParse(section[name], out var on) || on;
        return new PracticeModeSettings
        {
            WarmUp = On(nameof(PracticeModeSettings.WarmUp)),
            PitchMatch = On(nameof(PracticeModeSettings.PitchMatch)),
            Intervals = On(nameof(PracticeModeSettings.Intervals)),
            Harmony = On(nameof(PracticeModeSettings.Harmony)),
            Runs = On(nameof(PracticeModeSettings.Runs)),
            Rhythm = On(nameof(PracticeModeSettings.Rhythm)),
        };
    }
}
