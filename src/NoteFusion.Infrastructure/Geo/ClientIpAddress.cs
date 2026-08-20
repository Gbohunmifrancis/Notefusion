using System.Net;
using System.Net.Sockets;

namespace NoteFusion.Infrastructure.Geo;

/// <summary>
/// Works out which address a request really came from, given the forwarded-header chain and the socket
/// peer. Pure and static so the rule can be tested directly — it is a security boundary, and the only
/// thing standing between a caller and the price they would rather be shown.
/// </summary>
/// <remarks>
/// <para>
/// <c>X-Forwarded-For</c> is <b>appended to</b>, not set, by each hop. A client is free to send its own,
/// and the router in front of us adds the address it observed to the END of whatever arrived. So the
/// trustworthy entry is counted from the RIGHT: with one proxy in front (Heroku's router), it is the last
/// one. Reading the leftmost entry — the conventional "original client" reading, and the one that is
/// correct only when a proxy overwrites the header — reads a value the caller typed, which is precisely
/// the spoof this class exists to refuse. No number of entries a client prepends can move the right-hand
/// window.
/// </para>
/// <para>
/// Returns null rather than guessing whenever the answer would not be meaningful: no chain to read, an
/// unparseable address, or an address that is not publicly routable (loopback, private, link-local,
/// carrier-grade NAT). A local or containerised run therefore resolves to null and never bothers a
/// geolocation service with an address it could not place.
/// </para>
/// <para>
/// Public because the caller that has the header and the socket peer to hand is in the Api layer, where
/// <c>IHttpContextAccessor</c> lives; Infrastructure deliberately does not reference ASP.NET Core, so the
/// rule sits here as a pure function and the plumbing sits there.
/// </para>
/// </remarks>
public static class ClientIpAddress
{
    /// <summary>
    /// The caller's publicly routable address, or null when it cannot be established.
    /// </summary>
    /// <param name="forwardedFor">The raw <c>X-Forwarded-For</c> value, or null when absent.</param>
    /// <param name="remoteAddress">The socket peer, used only when there is no proxy chain to read.</param>
    /// <param name="trustedProxyHops">
    /// How many hops between the client and this process append to the chain. One for Heroku's router.
    /// Zero means nothing trustworthy sits in front, so the header is ignored entirely — a
    /// directly-exposed process must never believe a header only its caller could have written.
    /// </param>
    public static string? Resolve(string? forwardedFor, string? remoteAddress, int trustedProxyHops)
    {
        if (trustedProxyHops <= 0)
            return Publicly(remoteAddress);

        var chain = (forwardedFor ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        // A chain shorter than the hops we are told to expect is not a chain we can read a position in,
        // so fall back to the socket peer — which behind a proxy is the proxy itself, and so resolves to
        // null. Better a missing country than one the caller chose.
        if (chain.Length < trustedProxyHops)
            return Publicly(remoteAddress);

        return Publicly(chain[^trustedProxyHops]);
    }

    /// <summary>
    /// Normalises one entry — brackets, a trailing port, an IPv4-mapped IPv6 form — and keeps it only if
    /// it parses and is globally routable.
    /// </summary>
    private static string? Publicly(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return null;

        var value = candidate.Trim();

        // "[2001:db8::1]:443" and "[2001:db8::1]" — the bracketed form exists precisely so a port can be
        // told apart from the colons inside an IPv6 address.
        if (value.StartsWith('['))
        {
            var close = value.IndexOf(']');
            if (close < 0) return null;
            value = value[1..close];
        }
        else if (value.Count(c => c == ':') == 1)
        {
            // Exactly one colon means IPv4 with a port. More than one means bare IPv6, where a trailing
            // ":443" would be indistinguishable from another group — so it is left alone.
            value = value[..value.IndexOf(':')];
        }

        if (!IPAddress.TryParse(value, out var ip))
            return null;

        if (ip.IsIPv4MappedToIPv6)
            ip = ip.MapToIPv4();

        return IsRoutable(ip) ? ip.ToString() : null;
    }

    private static bool IsRoutable(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any))
            return false;

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            // Unique-local (fc00::/7) and link-local. A ULA is the IPv6 equivalent of 10.0.0.0/8.
            var first = ip.GetAddressBytes()[0];
            return !ip.IsIPv6LinkLocal && !ip.IsIPv6SiteLocal && (first & 0xFE) != 0xFC;
        }

        var b = ip.GetAddressBytes();
        return b[0] switch
        {
            10 => false,
            127 => false,
            // 100.64.0.0/10 — carrier-grade NAT. Shared between subscribers, so it identifies nobody.
            100 => b[1] < 64 || b[1] > 127,
            169 => b[1] != 254,           // link-local (169.254.0.0/16)
            172 => b[1] < 16 || b[1] > 31, // 172.16.0.0/12
            192 => b[1] != 168,
            _ => true,
        };
    }
}
