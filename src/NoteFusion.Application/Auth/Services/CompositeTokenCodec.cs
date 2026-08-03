namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// Encodes/decodes opaque tokens as "{tokenId}.{secret}" (used for refresh tokens). The id lets the
/// server load the stored row; the secret is verified against that row's bcrypt hash, since the hash
/// itself is not queryable.
/// </summary>
public static class CompositeTokenCodec
{
    private const char Separator = '.';

    public static string Compose(Guid tokenId, string secret) => $"{tokenId:N}{Separator}{secret}";

    public static bool TryParse(string? token, out Guid tokenId, out string secret)
    {
        tokenId = Guid.Empty;
        secret = string.Empty;
        if (string.IsNullOrWhiteSpace(token))
            return false;

        var parts = token.Split(Separator, 2);
        if (parts.Length != 2 || !Guid.TryParseExact(parts[0], "N", out tokenId) || string.IsNullOrEmpty(parts[1]))
            return false;

        secret = parts[1];
        return true;
    }
}
