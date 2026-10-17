using Microsoft.Extensions.Configuration;

namespace NoteFusion.Infrastructure.Security.Passkeys;

/// <summary>
/// The WebAuthn relying party, from the <c>Passkeys</c> section. Every value has a working default, so a
/// deploy sets nothing.
/// </summary>
/// <remarks>
/// <para>
/// <c>Passkeys__RpId</c> (default <c>notefusion.studio</c>): the registrable domain passkeys belong to. The
/// console on admin.notefusion.studio may use it because it is a suffix of the console's host, and the API
/// on api.notefusion.studio verifies against it. Development defaults to <c>localhost</c>, the only RP id a
/// console on http://localhost:3000 may use.
/// </para>
/// <para>
/// <c>Passkeys__Origins</c> (default <c>https://admin.notefusion.studio</c>): the pages allowed to run the
/// ceremony, comma-separated or as <c>__0</c>, <c>__1</c>. Development adds http://localhost:3000.
/// Vercel preview hosts cannot use passkeys: they are not under the RP id.
/// </para>
/// </remarks>
public sealed class PasskeySettings
{
    public const string DefaultRpId = "notefusion.studio";
    public const string DefaultOrigin = "https://admin.notefusion.studio";
    public const string DevelopmentOrigin = "http://localhost:3000";

    public required string RpId { get; init; }
    public string RpName { get; init; } = "NoteFusion";
    public required IReadOnlyList<string> Origins { get; init; }

    public static PasskeySettings Resolve(IConfiguration configuration, bool isDevelopment)
    {
        var section = configuration.GetSection("Passkeys");

        var rpId = section["RpId"]?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(rpId))
            rpId = isDevelopment ? "localhost" : DefaultRpId;

        var origins = new List<string>();
        void Add(string? value)
        {
            foreach (var origin in (value ?? string.Empty).Split(
                         [',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var trimmed = origin.TrimEnd('/');
                if (!origins.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
                    origins.Add(trimmed);
            }
        }

        Add(section["Origins"]);
        foreach (var child in section.GetSection("Origins").GetChildren())
            Add(child.Value);

        if (origins.Count == 0)
            Add(DefaultOrigin);
        if (isDevelopment)
            Add(DevelopmentOrigin);

        var rpName = section["RpName"]?.Trim();
        return new PasskeySettings
        {
            RpId = rpId,
            RpName = string.IsNullOrEmpty(rpName) ? "NoteFusion" : rpName,
            Origins = origins
        };
    }

    /// <summary>Origins whose host is neither the RP id nor under it: a browser there refuses the ceremony.</summary>
    public IEnumerable<string> OriginsOutsideRpId()
        => Origins.Where(o => !Uri.TryCreate(o, UriKind.Absolute, out var uri)
                              || !(uri.Host.Equals(RpId, StringComparison.OrdinalIgnoreCase)
                                   || uri.Host.EndsWith("." + RpId, StringComparison.OrdinalIgnoreCase)));
}
