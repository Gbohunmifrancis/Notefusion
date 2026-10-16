using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NoteFusion.Application.Blog;
using NoteFusion.Application.Blog.Drafting;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Infrastructure.Http;

namespace NoteFusion.Infrastructure.Blog;

/// <summary>
/// Registers the blog: its settings, the Gemini client (drafts), the GitHub client (site rebuilds), the site's
/// catalogue reader, and the two workers. Every outside call goes through <see cref="OutboundResilience"/>.
/// </summary>
public static class BlogDependencyInjection
{
    public static IServiceCollection AddBlog(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(ResolveSettings(configuration));
        services.AddSingleton(ResolveGemini(configuration));
        services.AddSingleton(ResolveGitHub(configuration));
        services.AddSingleton<BlogCatalogueCache>();

        services.AddHttpClient<IGeminiClient, GeminiClient>().AddOutboundResilience(OutboundResilience.Gemini);
        services.AddHttpClient<IGitHubActions, GitHubActionsClient>().AddOutboundResilience(OutboundResilience.GitHub);
        services.AddHttpClient<IBlogSiteCatalogue, SiteCatalogueClient>().AddOutboundResilience(OutboundResilience.Website);

        services.AddHostedService<BlogSiteWorker>();
        services.AddHostedService<BlogDraftWorker>();
        return services;
    }

    /// <summary>
    /// Read by hand, like <c>OutreachDependencyInjection.ResolveSettings</c>: the deploy writes every variable
    /// whether or not it has a value, and an empty one must take the default rather than fail the binder.
    /// </summary>
    public static BlogSettings ResolveSettings(IConfiguration configuration)
    {
        var blog = configuration.GetSection("Blog");
        var gemini = configuration.GetSection("Gemini");
        var d = new BlogSettings();
        return new BlogSettings
        {
            SiteUrl = Text(blog["SiteUrl"]) ?? d.SiteUrl,
            GeminiModel = Text(gemini["Model"]) ?? d.GeminiModel,
            GeminiMaxOutputTokens = int.TryParse(gemini["MaxOutputTokens"], out var max) && max > 0 ? max : d.GeminiMaxOutputTokens,
            GeminiFallbackModels = Models(gemini["FallbackModels"]) ?? d.GeminiFallbackModels,
            AutoDraftEnabled = bool.TryParse(blog["AutoDraftEnabled"], out var on) ? on : d.AutoDraftEnabled,
            AutoDraftDays = Days(blog["AutoDraftDays"]) ?? d.AutoDraftDays,
            AutoDraftTimeUtc = TimeOnly.TryParseExact(Text(blog["AutoDraftTimeUtc"]) ?? string.Empty, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
                ? at : d.AutoDraftTimeUtc,
            AutoDraftCount = int.TryParse(blog["AutoDraftCount"], out var count) && count is > 0 and <= 10 ? count : d.AutoDraftCount,
        };
    }

    public static GeminiSettings ResolveGemini(IConfiguration configuration)
    {
        var section = configuration.GetSection("Gemini");
        return new GeminiSettings { ApiKey = Text(section["ApiKey"]) ?? string.Empty };
    }

    public static GitHubSettings ResolveGitHub(IConfiguration configuration)
    {
        var section = configuration.GetSection("GitHub");
        var d = new GitHubSettings();
        return new GitHubSettings
        {
            Token = Text(section["Token"]) ?? string.Empty,
            Repo = Text(section["Repo"]) ?? d.Repo,
            Workflow = Text(section["Workflow"]) ?? d.Workflow,
            Ref = Text(section["Ref"]) ?? d.Ref,
        };
    }

    /// <summary>"gemini-flash-latest, gemini-flash-lite-latest" → the models; "none" → no fallback; empty → the default.</summary>
    internal static IReadOnlyList<string>? Models(string? value)
    {
        var text = Text(value);
        if (text is null)
            return null;
        if (text.Equals("none", StringComparison.OrdinalIgnoreCase))
            return [];
        return text.Split([',', ' ', ';'], StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.Ordinal).ToList();
    }

    /// <summary>"Mon,Thu" or "Monday, Thursday" → the days; "none" → no days; empty → the default.</summary>
    internal static IReadOnlyList<DayOfWeek>? Days(string? value)
    {
        var text = Text(value);
        if (text is null)
            return null;
        if (text.Equals("none", StringComparison.OrdinalIgnoreCase))
            return [];
        var days = new List<DayOfWeek>();
        foreach (var part in text.Split([',', ' ', ';'], StringSplitOptions.RemoveEmptyEntries))
        {
            var match = Enum.GetValues<DayOfWeek>().FirstOrDefault(
                day => day.ToString().StartsWith(part, StringComparison.OrdinalIgnoreCase) && part.Length >= 2, (DayOfWeek)(-1));
            if ((int)match < 0)
                return null;
            if (!days.Contains(match))
                days.Add(match);
        }
        return days;
    }

    private static string? Text(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
