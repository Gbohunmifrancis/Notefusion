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
builder.Services.AddAuthorization(options => options.AddNoteFusionPolicies());

// CORS for the admin dashboard, which runs on its own origin. Origins come from config
// (Cors__AllowedOrigins__0, __1, …) because the dev origin and the deployed one differ. Origins are
// listed explicitly rather than using AllowAnyOrigin so that a browser on an unknown site cannot
// read admin analytics; with no origins configured the policy allows nothing, so a misconfigured
// deploy fails closed. POST is needed for /api/auth/login and /api/auth/refresh, which the
// dashboard calls before it can read anything.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy(AdminDashboardCorsPolicy, policy =>
    {
        if (allowedOrigins.Length == 0) return;

        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .WithMethods("GET", "POST", "OPTIONS");
    });
});

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

// CORS sits before auth so a preflight, which carries no Authorization header, gets its headers
// back instead of a 401 the browser would report as an opaque CORS failure.
app.UseCors(AdminDashboardCorsPolicy);

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

/// <summary>Exposed so the integration-test host (WebApplicationFactory) can reference the entry point.</summary>
public partial class Program
{
    /// <summary>Name of the CORS policy applied to the whole app for the admin dashboard's origin.</summary>
    public const string AdminDashboardCorsPolicy = "AdminDashboard";
}
