using System.Reflection;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Behaviors;

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

        return services;
    }
}
