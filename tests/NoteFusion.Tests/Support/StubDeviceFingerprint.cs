using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

/// <summary>
/// An <see cref="IDeviceFingerprint"/> that answers whatever a test sets, and null by default — which is
/// what every install that predates the <c>X-Device-Id</c> header sends, and therefore the fail-open path
/// the existing Play installed base runs on. Defaulting to a device would leave that path untested, and it
/// is the one that must never lock a stranger out.
/// </summary>
/// <remarks>
/// The value is opaque everywhere downstream — the real implementation hands over a SHA-256 hex string, but
/// nothing compares it to anything but itself, so a test may use a readable name like <c>"phone-a"</c>.
/// </remarks>
public sealed class StubDeviceFingerprint : IDeviceFingerprint
{
    public StubDeviceFingerprint(string? current = null) => Current = current;

    public string? Current { get; set; }
}
