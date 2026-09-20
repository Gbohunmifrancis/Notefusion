using System.Security.Cryptography;
using System.Text;

namespace NoteFusion.Application.WebPreview;

internal static class WebPreviewToken
{
    public static string Create()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

    public static string Hash(string token)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
