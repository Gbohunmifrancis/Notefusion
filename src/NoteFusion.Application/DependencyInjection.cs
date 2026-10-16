using System.Reflection;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Behaviors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Services;

namespace NoteFusion.Application;

/// <summary>Registers Application-layer services: MediatR, validators, pipeline behaviors.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = Assembly.GetExecutingAssembly();

        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
            cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
        });

        services.AddValidatorsFromAssembly(assembly, includeInternalTypes: true);
        services.AddScoped<ITokenIssuer, TokenIssuer>();
        services.AddScoped<IAuditLogger, AuditLogger>();
        services.AddScoped<ITrialDeviceRecorder, TrialDeviceRecorder>();
        services.AddScoped<Activity.ActivityRecorder>();
        services.AddScoped<Outreach.OutreachService>();
        services.AddScoped<Blog.Drafting.BlogDraftWriter>();
        services.AddScoped<Blog.Drafting.BlogGenerationRunner>();
        services.AddScoped<Blog.Publishing.BlogSitePublisher>();

        return services;
    }
}
