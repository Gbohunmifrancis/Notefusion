using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Blog.Publishing;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.Blog;

/// <summary>
/// <c>GitHub__Token</c> (a fine-grained token with Actions: read and write on the repository), <c>GitHub__Repo</c>
/// ("owner/name"), the workflow file and the branch it runs on.
/// </summary>
public sealed class GitHubSettings
{
    public string Token { get; init; } = string.Empty;
    public string Repo { get; init; } = "Gbohunmifrancis/Notefusion";
    public string Workflow { get; init; } = "deploy-web.yml";
    public string Ref { get; init; } = "main";
    public string ApiBaseUrl { get; init; } = "https://api.github.com/";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Token) && Repo.Contains('/');
}

/// <summary>
/// The REST calls the blog makes: <c>POST /repos/{repo}/actions/workflows/{workflow}/dispatches</c> to rebuild and
/// deploy the website, and <c>GET …/runs?per_page=1</c> for the console's "last deploy". GitHub answers a
/// dispatch with 204.
/// </summary>
internal sealed class GitHubActionsClient : IGitHubActions
{
    private readonly HttpClient _http;
    private readonly GitHubSettings _settings;
    private readonly ILogger<GitHubActionsClient> _logger;

    public GitHubActionsClient(HttpClient http, GitHubSettings settings, ILogger<GitHubActionsClient> logger)
    {
        _http = http;
        _settings = settings;
        _logger = logger;
    }

    public bool IsConfigured => _settings.IsConfigured;

    public string Target => $"{_settings.Repo} · {_settings.Workflow} on {_settings.Ref}";

    public async Task<Result> DispatchSiteDeployAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return Error.Failure("GITHUB_NOT_CONFIGURED", "Site rebuilds are off: set GitHub__Token on the API.");
        using var request = Request(HttpMethod.Post, $"repos/{_settings.Repo}/actions/workflows/{Uri.EscapeDataString(_settings.Workflow)}/dispatches");
        request.Content = new StringContent(JsonSerializer.Serialize(new { @ref = _settings.Ref }), Encoding.UTF8, "application/json");
        var sent = await SendAsync(request, ct);
        if (sent.IsFailure)
            return sent.Error;
        using var response = sent.Value;
        if (response.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.OK)
            return Result.Success();
        return await Refusal(response, ct);
    }

    public async Task<Result<SiteDeployRun?>> LatestSiteDeployAsync(CancellationToken ct)
    {
        if (!IsConfigured)
            return Error.Failure("GITHUB_NOT_CONFIGURED", "Site rebuilds are off: set GitHub__Token on the API.");
        using var request = Request(HttpMethod.Get, $"repos/{_settings.Repo}/actions/workflows/{Uri.EscapeDataString(_settings.Workflow)}/runs?per_page=1");
        var sent = await SendAsync(request, ct);
        if (sent.IsFailure)
            return sent.Error;
        using var response = sent.Value;
        if (!response.IsSuccessStatusCode)
            return await Refusal(response, ct);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!doc.RootElement.TryGetProperty("workflow_runs", out var runs) || runs.GetArrayLength() == 0)
            return Result.Success<SiteDeployRun?>(null);
        var run = runs[0];
        string? Str(string name) => run.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var created = DateTime.TryParse(Str("created_at"), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var at)
            ? at : DateTime.MinValue;
        return Result.Success<SiteDeployRun?>(new SiteDeployRun(Str("status") ?? "unknown", Str("conclusion"), Str("html_url") ?? string.Empty, created, Str("event") ?? string.Empty));
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(_settings.ApiBaseUrl), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.Token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("NoteFusion-API", "1.0"));
        return request;
    }

    private async Task<Result<HttpResponseMessage>> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            return await _http.SendAsync(request, ct);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return OutboundFailure.ToError(ex, "GITHUB_UNAVAILABLE", "GitHub");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not reach GitHub: {Message}", ex.Message);
            return Error.Network("GITHUB_UNAVAILABLE", "Could not reach GitHub.");
        }
    }

    private static async Task<Error> Refusal(HttpResponseMessage response, CancellationToken ct)
    {
        var body = await response.Content.ReadAsStringAsync(ct);
        string? message = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("message", out var m))
                message = m.GetString();
        }
        catch (JsonException)
        {
        }
        var code = (int)response.StatusCode;
        var hint = code is 401 or 403 or 404
            ? " (check GitHub__Token: a fine-grained token with Actions read and write on the repository, and GitHub__Repo)"
            : string.Empty;
        return code >= 500
            ? Error.Network("GITHUB_UNAVAILABLE", $"GitHub answered {code}.")
            : Error.Failure("GITHUB_REFUSED", $"GitHub answered {code}: {message ?? response.ReasonPhrase}{hint}");
    }
}
