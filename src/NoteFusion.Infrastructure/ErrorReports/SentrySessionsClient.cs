using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Admin.Sessions;
using NoteFusion.Infrastructure.Http;
using NoteFusion.Shared.Results;

namespace NoteFusion.Infrastructure.ErrorReports;

/// <summary>
/// <c>SentryApi__Token</c> (an internal integration's token: Organization, Project and Issue &amp; Event, read),
/// <c>SentryApi__Org</c> (the organisation's slug) and the API's address. Unset, the Sessions page says how to connect it.
/// </summary>
public sealed class SentryApiSettings
{
    public string Token { get; init; } = string.Empty;
    public string Org { get; init; } = string.Empty;
    public string BaseUrl { get; init; } = "https://sentry.io/";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(Token) && SessionRules.IsSlug(Org);
}

public static class SentryDependencyInjection
{
    public static IServiceCollection AddSentrySessions(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection("SentryApi");
        var d = new SentryApiSettings();
        // Read by hand, like the blog's: the deploy writes every variable whether or not it has a value.
        services.AddSingleton(new SentryApiSettings
        {
            Token = Text(section["Token"]) ?? d.Token,
            Org = Text(section["Org"]) ?? d.Org,
            BaseUrl = Text(section["BaseUrl"]) ?? d.BaseUrl,
        });
        services.AddSingleton<SentryProjectsCache>();
        services.AddHttpClient<ISentrySessions, SentrySessionsClient>().AddOutboundResilience(OutboundResilience.SentryApi);
        return services;
    }

    private static string? Text(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>The organisation's projects barely change and every Sessions call needs them: kept ten minutes.</summary>
internal sealed class SentryProjectsCache
{
    private static readonly TimeSpan KeptFor = TimeSpan.FromMinutes(10);
    private readonly TimeProvider _time;
    private Entry? _entry;

    public SentryProjectsCache(TimeProvider? time = null) => _time = time ?? TimeProvider.System;

    private sealed record Entry(DateTimeOffset At, IReadOnlyList<SentryProject> Projects);

    public IReadOnlyList<SentryProject>? Get()
        => Volatile.Read(ref _entry) is { } e && _time.GetUtcNow() - e.At < KeptFor ? e.Projects : null;

    public void Set(IReadOnlyList<SentryProject> projects) => Volatile.Write(ref _entry, new Entry(_time.GetUtcNow(), projects));
}

/// <summary>
/// Sentry's REST API as the Sessions page reads it: the organisation's projects, its replays (a phone recording is a
/// replay whose pieces are short MP4s), a replay's recording segments (rrweb events: a <c>video</c> custom event per
/// piece, <c>breadcrumb</c> and <c>performanceSpan</c> events for what happened), error events and issues. Every read is
/// a GET through <see cref="OutboundResilience.SentryApi"/>; Sentry's own text never reaches the console.
/// </summary>
internal sealed partial class SentrySessionsClient : ISentrySessions
{
    private const int MaxSegmentPages = 10;

    private readonly HttpClient _http;
    private readonly SentryApiSettings _settings;
    private readonly SentryProjectsCache _projects;
    private readonly ILogger<SentrySessionsClient> _logger;

    public SentrySessionsClient(
        HttpClient http, SentryApiSettings settings, SentryProjectsCache projects, ILogger<SentrySessionsClient> logger)
    {
        _http = http;
        _settings = settings;
        _projects = projects;
        _logger = logger;
    }

    public bool IsConfigured => _settings.IsConfigured;

    public string Org => _settings.Org;

    public async Task<Result<IReadOnlyList<SentryProject>>> ProjectsAsync(CancellationToken ct)
    {
        if (_projects.Get() is { } cached)
            return Result.Success(cached);
        var read = await GetJsonAsync($"api/0/organizations/{_settings.Org}/projects/?per_page=100", ct);
        if (read.IsFailure)
            return read.Error;
        using var doc = read.Value.Doc;
        var projects = ReadProjects(doc.RootElement);
        _projects.Set(projects);
        return Result.Success(projects);
    }

    public async Task<Result<SentryReplayPage>> ReplaysAsync(bool withErrors, string? cursor, CancellationToken ct)
    {
        var path = $"api/0/organizations/{_settings.Org}/replays/?statsPeriod=14d&per_page=25&sort=-started_at"
                   + (withErrors ? "&query=" + Uri.EscapeDataString("count_errors:>0") : string.Empty)
                   + (IsCursor(cursor) ? "&cursor=" + Uri.EscapeDataString(cursor!) : string.Empty);
        var read = await GetJsonAsync(path, ct);
        if (read.IsFailure)
            return read.Error;
        using var doc = read.Value.Doc;
        var data = doc.RootElement.TryGetProperty("data", out var d) ? d : doc.RootElement;
        var items = data.ValueKind == JsonValueKind.Array ? data.EnumerateArray().Select(ReadReplay).ToList() : [];
        return new SentryReplayPage(items, read.Value.NextCursor);
    }

    public async Task<Result<SentryReplay?>> ReplayAsync(string replayId, CancellationToken ct)
    {
        var read = await GetJsonAsync($"api/0/organizations/{_settings.Org}/replays/{replayId}/", ct, notFoundIsEmpty: true);
        if (read.IsFailure)
            return read.Error;
        if (read.Value.Doc is null)
            return Result.Success<SentryReplay?>(null);
        using var doc = read.Value.Doc;
        var data = doc.RootElement.TryGetProperty("data", out var d) ? d : doc.RootElement;
        return Result.Success<SentryReplay?>(data.ValueKind == JsonValueKind.Object ? ReadReplay(data) : null);
    }

    public async Task<Result<SentryRecording>> RecordingAsync(string projectSlug, string replayId, CancellationToken ct)
    {
        var videos = new List<SentryVideoPiece>();
        var steps = new List<SentryStep>();
        string? cursor = null;
        for (var page = 0; page < MaxSegmentPages; page++)
        {
            var path = $"api/0/projects/{_settings.Org}/{projectSlug}/replays/{replayId}/recording-segments/?per_page=100"
                       + (cursor is null ? string.Empty : "&cursor=" + Uri.EscapeDataString(cursor));
            var read = await GetJsonAsync(path, ct);
            if (read.IsFailure)
                return read.Error;
            using (var doc = read.Value.Doc)
                ReadSegments(doc.RootElement, videos, steps);
            if (read.Value.NextCursor is null)
                break;
            cursor = read.Value.NextCursor;
        }
        return new SentryRecording(videos, steps);
    }

    public async Task<Result<byte[]>> VideoAsync(string projectSlug, string replayId, int segmentId, CancellationToken ct)
    {
        using var request = Request($"api/0/projects/{_settings.Org}/{projectSlug}/replays/{replayId}/videos/{segmentId}/");
        var sent = await SendAsync(request, ct);
        if (sent.IsFailure)
            return sent.Error;
        using var response = sent.Value;
        if (response.StatusCode == HttpStatusCode.NotFound)
            return SessionRules.UnknownRecording;
        if (!response.IsSuccessStatusCode)
            return Refusal(response);
        return await response.Content.ReadAsByteArrayAsync(ct);
    }

    public async Task<Result<SentryErrorEvent?>> ErrorEventAsync(string projectSlug, string eventId, CancellationToken ct)
    {
        var read = await GetJsonAsync($"api/0/projects/{_settings.Org}/{projectSlug}/events/{eventId}/", ct, notFoundIsEmpty: true);
        if (read.IsFailure)
            return read.Error;
        if (read.Value.Doc is null)
            return Result.Success<SentryErrorEvent?>(null);
        using var doc = read.Value.Doc;
        return Result.Success<SentryErrorEvent?>(ReadErrorEvent(doc.RootElement));
    }

    public async Task<Result<IReadOnlyList<SentryIssue>>> IssuesAsync(string? projectId, CancellationToken ct)
    {
        var path = $"api/0/organizations/{_settings.Org}/issues/?statsPeriod=7d&sort=user&limit=25&query="
                   + Uri.EscapeDataString("is:unresolved")
                   + (projectId is not null && projectId.All(char.IsAsciiDigit) ? "&project=" + projectId : string.Empty);
        var read = await GetJsonAsync(path, ct);
        if (read.IsFailure)
            return read.Error;
        using var doc = read.Value.Doc;
        var root = doc.RootElement;
        IReadOnlyList<SentryIssue> issues = root.ValueKind == JsonValueKind.Array ? root.EnumerateArray().Select(ReadIssue).ToList() : [];
        return Result.Success(issues);
    }

    public async Task<Result<string?>> LatestReplayOfIssueAsync(string issueId, CancellationToken ct)
    {
        var read = await GetJsonAsync($"api/0/organizations/{_settings.Org}/issues/{issueId}/events/latest/", ct, notFoundIsEmpty: true);
        if (read.IsFailure)
            return read.Error;
        if (read.Value.Doc is null)
            return Result.Success<string?>(null);
        using var doc = read.Value.Doc;
        return Result.Success(ReplayIdOf(doc.RootElement));
    }

    // ── Reading Sentry's JSON (internal for the tests) ─────────────────────────────────────────────────────────────

    internal static IReadOnlyList<SentryProject> ReadProjects(JsonElement root)
        => root.ValueKind != JsonValueKind.Array
            ? []
            : root.EnumerateArray()
                .Select(p => new SentryProject(Str(p, "id") ?? string.Empty, Str(p, "slug") ?? string.Empty, Str(p, "platform") ?? string.Empty))
                .Where(p => p.Id.Length > 0 && SessionRules.IsSlug(p.Slug))
                .ToList();

    internal static SentryReplay ReadReplay(JsonElement r)
    {
        var device = Obj(r, "device");
        var os = Obj(r, "os");
        var deviceName = device is { } dv
            ? Join(Str(dv, "brand"), Str(dv, "model")) ?? Str(dv, "name") ?? Str(dv, "family")
            : null;
        var osName = os is { } o ? Join(Str(o, "name"), Str(o, "version")) : null;
        var user = Obj(r, "user");
        return new SentryReplay(
            Str(r, "id") ?? string.Empty,
            Str(r, "project_id") ?? string.Empty,
            Time(r, "started_at") ?? DateTime.MinValue,
            Time(r, "finished_at"),
            Int(r, "duration"),
            Int(r, "count_errors"),
            user is { } u ? Str(u, "id") : null,
            deviceName,
            osName,
            Strings(r, "releases").FirstOrDefault(),
            Strings(r, "urls"),
            Strings(r, "error_ids"));
    }

    /// <summary>The recording segments' events: each <c>video</c> custom event is a piece; breadcrumbs and network spans are steps.</summary>
    internal static void ReadSegments(JsonElement root, List<SentryVideoPiece> videos, List<SentryStep> steps)
    {
        var segments = root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var d) ? d : root;
        if (segments.ValueKind != JsonValueKind.Array)
            return;
        foreach (var segment in segments.EnumerateArray())
        {
            if (segment.ValueKind != JsonValueKind.Array)
                continue;
            foreach (var e in segment.EnumerateArray())
            {
                if (e.ValueKind != JsonValueKind.Object || Int(e, "type") != 5 || Obj(e, "data") is not { } data)
                    continue;
                var payload = Obj(data, "payload");
                if (payload is not { } p)
                    continue;
                var at = Millis(e, "timestamp");
                switch (Str(data, "tag"))
                {
                    case "video" when Int(p, "segmentId", -1) >= 0 && at is { } start:
                        videos.Add(new SentryVideoPiece(Int(p, "segmentId"), start, Int(p, "duration")));
                        break;
                    case "breadcrumb" when Step(p) is { } step:
                        steps.Add(step with { At = Seconds(p, "timestamp") ?? at ?? DateTime.MinValue });
                        break;
                    case "performanceSpan" when Span(p) is { } span:
                        steps.Add(span);
                        break;
                }
            }
        }
    }

    /// <summary>What a breadcrumb says, in the console's words; console logs and Sentry's own bookkeeping are left out.</summary>
    internal static SentryStep? Step(JsonElement crumb)
    {
        var category = Str(crumb, "category") ?? string.Empty;
        var message = Str(crumb, "message");
        var data = Obj(crumb, "data");
        string? Field(string name) => data is { } dd ? Str(dd, name) : null;

        if (category == "navigation")
        {
            var to = Field("to") ?? Field("screen") ?? message;
            return to is null ? null : new SentryStep(DateTime.MinValue, "screen", Clip(to));
        }
        if (category.StartsWith("ui.tap", StringComparison.Ordinal) || category == "ui.click" || category == "touch")
        {
            var what = message ?? Field("target") ?? Field("label");
            return new SentryStep(DateTime.MinValue, "tap", what is null ? "Tapped" : "Tapped " + Clip(what));
        }
        if (category is "http" or "xhr" or "fetch")
        {
            var status = data is { } h && h.TryGetProperty("status_code", out var sc) && sc.TryGetInt32(out var code) ? code : (int?)null;
            return new SentryStep(DateTime.MinValue, "request", RequestLine(Field("method"), Field("url"), status));
        }
        if (category.StartsWith("app.", StringComparison.Ordinal) || category == "app.lifecycle")
        {
            var state = (Field("state") ?? message ?? category[4..]).ToLowerInvariant();
            return new SentryStep(DateTime.MinValue, "app",
                state.Contains("background") ? "App went to the background" : state.Contains("foreground") ? "App back in front" : Clip(state));
        }
        if (category == "network.connectivity")
            return new SentryStep(DateTime.MinValue, "app", "Connection: " + Clip(Field("state") ?? message ?? "changed"));
        if (category is "console" or "sentry.event" or "sentry.transaction" or "replay.mutations" || message is null)
            return null;
        return new SentryStep(DateTime.MinValue, "note", Clip(message));
    }

    /// <summary>A network span (<c>resource.http</c>, <c>resource.fetch</c>, <c>resource.xhr</c>) as "POST /api/transcriptions → 201".</summary>
    internal static SentryStep? Span(JsonElement span)
    {
        var op = Str(span, "op") ?? string.Empty;
        if (!op.StartsWith("resource.", StringComparison.Ordinal))
            return null;
        var data = Obj(span, "data");
        var status = data is { } d && d.TryGetProperty("statusCode", out var sc) && sc.TryGetInt32(out var code) ? code : (int?)null;
        var method = data is { } dm ? Str(dm, "method") : null;
        var at = Seconds(span, "startTimestamp");
        return at is null ? null : new SentryStep(at.Value, "request", RequestLine(method, Str(span, "description"), status));
    }

    internal static SentryErrorEvent? ReadErrorEvent(JsonElement e)
    {
        var id = Str(e, "eventID") ?? Str(e, "id");
        if (id is null)
            return null;
        var frames = new List<string>();
        if (e.TryGetProperty("entries", out var entries) && entries.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in entries.EnumerateArray().Where(x => Str(x, "type") == "exception"))
            {
                var values = Obj(entry, "data") is { } data && data.TryGetProperty("values", out var v) && v.ValueKind == JsonValueKind.Array
                    ? v.EnumerateArray().ToList() : [];
                // The exception that was thrown last is the one people see; its own frames, innermost first.
                var thrown = values.LastOrDefault();
                if (thrown.ValueKind == JsonValueKind.Object && Obj(thrown, "stacktrace") is { } st
                    && st.TryGetProperty("frames", out var fs) && fs.ValueKind == JsonValueKind.Array)
                {
                    var all = fs.EnumerateArray().Reverse().ToList();
                    var own = all.Where(f => f.TryGetProperty("inApp", out var ia) && ia.ValueKind == JsonValueKind.True).ToList();
                    frames.AddRange((own.Count > 0 ? own : all).Take(4).Select(Frame));
                }
            }
        }
        return new SentryErrorEvent(id, Time(e, "dateCreated") ?? Time(e, "dateReceived") ?? DateTime.MinValue, Str(e, "title") ?? "Error", frames);
    }

    internal static SentryIssue ReadIssue(JsonElement i)
        => new(
            Str(i, "id") ?? string.Empty,
            Str(i, "title") ?? "Error",
            Str(i, "culprit") ?? string.Empty,
            Obj(i, "project") is { } p ? Str(p, "id") ?? string.Empty : string.Empty,
            // Sentry writes an issue's count as a string.
            int.TryParse(Str(i, "count"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : Int(i, "count"),
            Int(i, "userCount"),
            Time(i, "firstSeen") ?? DateTime.MinValue,
            Time(i, "lastSeen") ?? DateTime.MinValue,
            Str(i, "permalink") ?? string.Empty);

    /// <summary>The replay an event belongs to: its <c>replay</c> context, else its <c>replayId</c> tag.</summary>
    internal static string? ReplayIdOf(JsonElement e)
    {
        if (Obj(e, "contexts") is { } c && Obj(c, "replay") is { } r && Str(r, "replay_id") is { } fromContext)
            return fromContext;
        if (e.TryGetProperty("tags", out var tags) && tags.ValueKind == JsonValueKind.Array)
            foreach (var t in tags.EnumerateArray())
                if (Str(t, "key") is "replayId" or "replay_id")
                    return Str(t, "value");
        return null;
    }

    /// <summary>The cursor in Sentry's Link header for the next page, when it says there are results.</summary>
    internal static string? NextCursor(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Link", out var links))
            return null;
        foreach (var part in string.Join(",", links).Split(','))
        {
            if (!part.Contains("rel=\"next\"") || !part.Contains("results=\"true\""))
                continue;
            var m = CursorPattern().Match(part);
            if (m.Success)
                return m.Groups[1].Value;
        }
        return null;
    }

    // ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────

    private sealed record Read(JsonDocument Doc, string? NextCursor);

    /// <summary>A GET read as JSON; with <paramref name="notFoundIsEmpty"/> a 404 is a success with no document.</summary>
    private async Task<Result<Read>> GetJsonAsync(string path, CancellationToken ct, bool notFoundIsEmpty = false)
    {
        using var request = Request(path);
        var sent = await SendAsync(request, ct);
        if (sent.IsFailure)
            return sent.Error;
        using var response = sent.Value;
        if (notFoundIsEmpty && response.StatusCode == HttpStatusCode.NotFound)
            return new Read(null!, null);
        if (!response.IsSuccessStatusCode)
            return Refusal(response);
        try
        {
            var doc = JsonDocument.Parse(await response.Content.ReadAsStreamAsync(ct));
            return new Read(doc, NextCursor(response));
        }
        catch (JsonException)
        {
            _logger.LogWarning("Sentry answered {Path} with something that is not JSON", path.Split('?')[0]);
            return Error.Network("SESSIONS_SENTRY_UNAVAILABLE", "Sentry's answer could not be read.");
        }
    }

    private HttpRequestMessage Request(string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(_settings.BaseUrl), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.Token);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("NoteFusion-API", "1.0"));
        return request;
    }

    private async Task<Result<HttpResponseMessage>> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        try
        {
            return await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (Exception ex) when (OutboundFailure.IsUnanswered(ex, ct))
        {
            return OutboundFailure.ToError(ex, "SESSIONS_SENTRY_UNAVAILABLE", "Sentry");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("Could not reach Sentry: {Message}", ex.Message);
            return Error.Network("SESSIONS_SENTRY_UNAVAILABLE", "Could not reach Sentry.");
        }
    }

    private Error Refusal(HttpResponseMessage response)
    {
        var code = (int)response.StatusCode;
        _logger.LogWarning("Sentry answered {Status} to {Path}", code, response.RequestMessage?.RequestUri?.AbsolutePath);
        return code switch
        {
            401 or 403 => Error.Failure(
                "SESSIONS_SENTRY_REFUSED",
                "Sentry refused the console's token. It needs read access to Organization, Project and Issue & Event (SENTRY_API_TOKEN)."),
            // A single recording's or event's 404 is answered before this; here it is a list, so the organisation is wrong.
            404 => Error.Failure("SESSIONS_SENTRY_NOT_FOUND", "Sentry has no organisation by that name: check SENTRY_ORG."),
            429 => Error.Network("SESSIONS_SENTRY_BUSY", "Sentry asked us to slow down. Try again in a minute."),
            _ => Error.Network("SESSIONS_SENTRY_UNAVAILABLE", $"Sentry answered {code}."),
        };
    }

    // ── Small readers ───────────────────────────────────────────────────────────────────────────────────────────

    private static bool IsCursor(string? cursor) => cursor is not null && cursor.Length <= 100 && CursorChars().IsMatch(cursor);

    private static string RequestLine(string? method, string? url, int? status)
    {
        var path = url is null ? "a request" : Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.AbsolutePath : url.Split('?')[0];
        return $"{(method ?? "GET").ToUpperInvariant()} {Clip(path)}" + (status is { } s ? $" → {s}" : string.Empty);
    }

    private static string Frame(JsonElement f)
    {
        var file = Str(f, "filename") ?? Str(f, "module") ?? Str(f, "absPath") ?? "?";
        var line = f.TryGetProperty("lineNo", out var l) && l.TryGetInt32(out var ln) ? $":{ln}" : string.Empty;
        return $"at {Str(f, "function") ?? "?"} ({file}{line})";
    }

    private static string Clip(string text) => text.Length <= 200 ? text : text[..200] + "…";

    private static string? Join(string? a, string? b)
        => a is null && b is null ? null : string.Join(" ", new[] { a, b }.Where(x => !string.IsNullOrWhiteSpace(x)));

    private static JsonElement? Obj(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? v : null;

    private static string? Str(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
            ? v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.Number => v.GetRawText(),
                _ => null,
            }
            : null;

    private static int Int(JsonElement e, string name, int fallback = 0)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
            ? v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) ? (int)n
              : v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s) ? s : fallback
            : fallback;

    private static IReadOnlyList<string> Strings(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
            : [];

    private static DateTime? Time(JsonElement e, string name)
        => Str(e, name) is { } s && DateTime.TryParse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t) ? t : null;

    /// <summary>A Unix time in milliseconds (rrweb's event timestamps).</summary>
    private static DateTime? Millis(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetDouble(out var ms)
            ? DateTime.UnixEpoch.AddMilliseconds(ms) : null;

    /// <summary>A Unix time in seconds, with a fraction (Sentry's breadcrumb and span timestamps).</summary>
    private static DateTime? Seconds(JsonElement e, string name)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetDouble(out var s)
            ? DateTime.UnixEpoch.AddMilliseconds(s * 1000) : null;

    [GeneratedRegex("cursor=\"([^\"]+)\"")]
    private static partial Regex CursorPattern();

    [GeneratedRegex("^[0-9A-Za-z:._-]+$")]
    private static partial Regex CursorChars();
}
