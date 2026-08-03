using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Models;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Common;
using NoteFusion.Api.Middleware;
using NoteFusion.Application;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure;

// Load a local .env if present (dev convenience); real config comes from env vars in compose/prod.
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

// Configuration: environment variables (and an optional .env) override appsettings so the same
// image runs in dev and compose with only env changes.
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Ambient caller identity resolved from the JWT.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
    });

// JWT auth — bearer options are configured against the shared RSA key (see ConfigureJwtBearerOptions).
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();
builder.Services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureJwtBearerOptions>();
builder.Services.AddAuthorization();

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

// Terminal error boundary — first in the pipeline so it wraps everything below.
app.UseMiddleware<ExceptionHandlingMiddleware>();

// Always enable Swagger UI documentation for API consumer testing & integration
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "NoteFusion API v1");
    options.RoutePrefix = "swagger";
    options.DocumentTitle = "NoteFusion API Documentation";
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

/// <summary>Exposed so the integration-test host (WebApplicationFactory) can reference the entry point.</summary>
public partial class Program;
