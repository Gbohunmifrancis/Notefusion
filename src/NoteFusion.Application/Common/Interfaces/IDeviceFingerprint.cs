namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// An opaque, stable identity for the handset the request in flight came from, or null when there is
/// nothing to read — no request (a background job, a test), or a client that sent no device header.
/// </summary>
/// <remarks>
/// <para>
/// Exists because the free-trial allowance is per <em>device</em>, not only per account: adding a second
/// Google account to an Android phone takes four taps, and without this the five free generations reset
/// every time one signs in. This is the only value that differs between two handsets and stays the same
/// when another account is added to one — a country or an address cannot tell those two accounts apart,
/// since they share both.
/// </para>
/// <para>
/// Same seam as <see cref="IClientIpAddress"/>: an ambient fact about the caller, read from the request
/// by the Api layer, consumed here as an interface. The value is already hashed by the time it arrives,
/// so nothing that reaches this layer or the database traces back to a physical device.
/// </para>
/// <para>
/// <b>It is a claim, not an attestation.</b> The client supplies it, so it is forgeable by anyone who
/// unpacks the app. It raises multi-account farming from four taps to reverse-engineering; it does not
/// make it impossible. Play Integrity is the answer if that day comes.
/// </para>
/// </remarks>
public interface IDeviceFingerprint
{
    string? Current { get; }
}
