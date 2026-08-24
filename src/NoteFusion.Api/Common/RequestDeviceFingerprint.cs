using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Common;

/// <summary>
/// Reads the device identity the client claims off the request in flight and hands the Application layer a
/// hash of it. Lives here for the same reason <see cref="RequestClientIpAddress"/> does:
/// <c>IHttpContextAccessor</c> is an Api concern, and the layers below only ever see the interface.
/// </summary>
/// <remarks>
/// <para>
/// Hashed rather than stored raw so that nothing in the database is a device identifier: equality is all
/// the trial ceiling ever asks of this value, and a hash answers that just as well. <b>Unsalted on
/// purpose.</b> A configurable salt is a trap here — set it in one environment and not another, or rotate
/// it, and every device silently starts from zero again. That is the failure that looks exactly like
/// success, and it would go unnoticed until the free tier was unlimited again.
/// </para>
/// <para>
/// A value that is too short, too long, or one of the placeholders clients send when they have nothing is
/// treated as no value at all, rather than hashed into a bucket that strangers then share. Sharing one
/// bucket is the dangerous direction: it does not leak an allowance, it refuses one to someone who never
/// used it, and a silently missing free trial is not something a user reports.
/// </para>
/// </remarks>
public sealed class RequestDeviceFingerprint : IDeviceFingerprint
{
    /// <summary>The header the mobile client sets on every request — see <c>mobile/src/lib/deviceId.ts</c>.</summary>
    public const string HeaderName = "X-Device-Id";

    /// <summary>
    /// Values that are technically present but identify nothing. The hex string is a real Android SSAID
    /// that a batch of early devices all shipped with, and it is still handed out by some emulators.
    /// </summary>
    private static readonly string[] Placeholders =
        ["null", "undefined", "unknown", "0", "9774d56d682e549c"];

    private readonly IHttpContextAccessor _http;

    public RequestDeviceFingerprint(IHttpContextAccessor http) => _http = http;

    public string? Current
    {
        get
        {
            var context = _http.HttpContext;
            if (context is null)
                return null; // no request in flight (a background job, a test)

            var claimed = context.Request.Headers[HeaderName].ToString().Trim();

            // 8 is shorter than anything a real platform hands out (an SSAID is 16 hex chars, an iOS
            // vendor id 36), and 200 is far past it — both bounds exist to reject junk, not to validate.
            if (claimed.Length is < 8 or > 200)
                return null;

            if (Placeholders.Contains(claimed, StringComparer.OrdinalIgnoreCase))
                return null;

            return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(claimed)));
        }
    }
}
