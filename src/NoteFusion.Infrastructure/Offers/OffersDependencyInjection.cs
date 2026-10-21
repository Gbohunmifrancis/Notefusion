using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Offers;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;

namespace NoteFusion.Infrastructure.Offers;

/// <summary>Registers the seasonal offers: their settings, the email's renderer (the console's preview) and the email worker.</summary>
public static class OffersDependencyInjection
{
    public static IServiceCollection AddOffers(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(ResolveSettings(configuration));
        services.AddSingleton<IOfferEmailRenderer, OfferEmailRenderer>();
        services.AddHostedService<OfferEmailWorker>();
        return services;
    }

    /// <summary>
    /// Read by hand rather than bound, like <see cref="OutreachDependencyInjection.ResolveSettings"/>: the deploy writes
    /// every variable whether or not its value exists, so an unset one arrives as "". <c>Offers__Enabled</c> is on unless
    /// it says false. The postal address is the email's (<c>Email__PostalAddress</c>), the site its <c>Email__AppUrl</c>
    /// and the unsubscribe link's origin the outreach notes' (<c>Outreach__ApiBaseUrl</c>), so each is set once.
    /// </summary>
    public static OfferSettings ResolveSettings(IConfiguration configuration)
    {
        var section = configuration.GetSection("Offers");
        var defaults = new OfferSettings();
        var email = EmailSettings.Resolve(configuration);
        return new OfferSettings
        {
            Enabled = !bool.TryParse(section["Enabled"], out var enabled) || enabled,
            BatchSize = int.TryParse(section["BatchSize"], out var batch) && batch > 0 ? batch : defaults.BatchSize,
            IntervalMinutes = int.TryParse(section["IntervalMinutes"], out var minutes) && minutes > 0
                ? minutes
                : defaults.IntervalMinutes,
            PostalAddress = email.PostalAddress,
            SiteUrl = email.AppUrl,
            ApiBaseUrl = OutreachDependencyInjection.ResolveSettings(configuration).ApiBaseUrl,
        };
    }
}
