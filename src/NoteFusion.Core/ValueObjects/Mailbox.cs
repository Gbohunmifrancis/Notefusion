namespace NoteFusion.Core.ValueObjects;

/// <summary>
/// The inbox an email address delivers to. Several addresses can reach one inbox — <c>you+1@gmail.com</c>,
/// <c>y.o.u@gmail.com</c> and <c>you@googlemail.com</c> are all <c>you@gmail.com</c> — and the free allowance
/// is one per inbox, so it is counted against this form rather than the address typed.
/// </summary>
/// <remarks>
/// The rule, and the only place it lives: lowercase; drop a <c>+tag</c> from the part before the <c>@</c>
/// (every domain: most providers deliver sub-addresses, and one that does not loses nothing but a tag);
/// for Gmail (<c>gmail.com</c>, <c>googlemail.com</c>) also drop the dots and read the domain as
/// <c>gmail.com</c>. Dots are kept everywhere else, where <c>a.b@</c> and <c>ab@</c> can be two people.
/// Never used to sign anyone in or to refuse a sign-up: it only decides whose free transcriptions are whose.
/// </remarks>
public static class Mailbox
{
    private const string Gmail = "gmail.com";

    /// <summary>
    /// The canonical inbox for <paramref name="email"/>. Input that is not a plain <c>local@domain</c> (no
    /// <c>@</c>, nothing before or after it) comes back trimmed and lowercased but otherwise as given, so the
    /// result is never empty for a non-empty address and never merges it with anything else.
    /// </summary>
    public static string Canonical(string email)
    {
        ArgumentNullException.ThrowIfNull(email);
        var address = email.Trim().ToLowerInvariant();

        // The last '@': a quoted local part may contain one, the domain never does.
        var at = address.LastIndexOf('@');
        if (at <= 0 || at == address.Length - 1)
            return address;

        var local = address[..at];
        var domain = address[(at + 1)..];

        // Everything from the first '+' is the tag. A local part that is nothing but a tag ("+x@") has no
        // inbox name left to keep, so it stays as typed rather than collapsing into "@domain".
        var plus = local.IndexOf('+');
        if (plus > 0)
            local = local[..plus];

        if (domain is Gmail or "googlemail.com")
        {
            domain = Gmail;
            var undotted = local.Replace(".", string.Empty, StringComparison.Ordinal);
            if (undotted.Length > 0)
                local = undotted;
        }

        return $"{local}@{domain}";
    }
}
