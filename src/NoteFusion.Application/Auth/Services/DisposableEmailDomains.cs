using System.Reflection;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// Throwaway-inbox domains (mailinator, 10minutemail, …) that password sign-up refuses. A disposable inbox
/// passes the emailed code like any other and is gone ten minutes later, which made it a fresh three free
/// transcriptions per address. The list is one text file, <c>disposable_email_domains.txt</c> beside this
/// class, embedded in the assembly and read once.
/// </summary>
/// <remarks>
/// Only sign-up reads this. Accounts already on such a domain are left alone, and Google sign-in never asks:
/// a Google identity is not a throwaway inbox.
/// </remarks>
public static class DisposableEmailDomains
{
    private const string ResourceName = "NoteFusion.Application.Auth.Services.disposable_email_domains.txt";

    private static readonly Lazy<HashSet<string>> Domains = new(Load);

    /// <summary>How many domains the list holds.</summary>
    public static int Count => Domains.Value.Count;

    /// <summary>
    /// Whether <paramref name="email"/>'s domain, or any domain it is under (<c>x.mailinator.com</c> is
    /// under <c>mailinator.com</c>), is on the list. False for anything without a domain to check.
    /// </summary>
    public static bool IsDisposable(string email)
    {
        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1)
            return false;

        var domain = email[(at + 1)..].Trim().TrimEnd('.').ToLowerInvariant();
        var set = Domains.Value;
        while (domain.Contains('.'))
        {
            if (set.Contains(domain))
                return true;
            domain = domain[(domain.IndexOf('.') + 1)..];
        }

        return false;
    }

    private static HashSet<string> Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded resource {ResourceName} is missing.");
        using var reader = new StreamReader(stream);

        var set = new HashSet<string>(StringComparer.Ordinal);
        while (reader.ReadLine() is { } line)
        {
            var domain = line.Trim().ToLowerInvariant();
            if (domain.Length > 0 && !domain.StartsWith('#'))
                set.Add(domain);
        }

        return set;
    }
}
