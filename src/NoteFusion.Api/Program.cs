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

// The admin dashboard ships inside this image: the Dockerfile builds web-admin/ into
// wwwroot, which makes the API its web server too. Without this the deployed dashboard
// answered every non-API path with an empty 404, which is what "the page is blank" was.
// Guarded on index.html so an API-only build (dotnet run, tests) still starts.
var webRoot = app.Environment.WebRootPath
    ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var dashboardIndex = Path.Combine(webRoot, "index.html");
var dashboardIsBundled = File.Exists(dashboardIndex);

if (dashboardIsBundled)
{
    // Rewrites "/" to "/index.html"; must precede UseStaticFiles to have anything to serve.
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

// CORS sits before auth so a preflight, which carries no Authorization header, gets its headers
// back instead of a 401 the browser would report as an opaque CORS failure.
app.UseCors(AdminDashboardCorsPolicy);

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

if (dashboardIsBundled)
{
    // Client-side routes (/login, /users) have no server route, so the shell is returned and
    // React Router resolves the path. /api and /swagger are excluded explicitly: an unknown
    // API path must still fail as a 404, not hand the caller an HTML page. This is a delegate
    // rather than MapFallbackToFile with a regex constraint because a route template splits on
    // "/" before constraints are parsed, so a regex containing "/" corrupts the template.
    app.MapFallback(async context =>
    {
        var path = context.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/swagger", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        // The shell must never be cached: it names hashed asset files, so a stale copy points
        // at bundles that no longer exist after a deploy.
        context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        await context.Response.SendFileAsync(dashboardIndex);
    });
}

app.Run();

/// <summary>Exposed so the integration-test host (WebApplicationFactory) can reference the entry point.</summary>
public partial class Program
{
    /// <summary>Name of the CORS policy applied to the whole app for the admin dashboard's origin.</summary>
    public const string AdminDashboardCorsPolicy = "AdminDashboard";
}
