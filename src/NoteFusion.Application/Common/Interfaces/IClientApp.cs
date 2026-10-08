namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Which client the request in flight came from: <c>"web"</c> (a browser), <c>"app"</c> (the mobile app) or
/// null when there is no request (a background job, a test). Read from the request by the Api layer, the
/// same seam as <see cref="IDeviceFingerprint"/>; only the activity log uses it, to say where a
/// transcription was sent from.
/// </summary>
public interface IClientApp
{
    string? Current { get; }
}
