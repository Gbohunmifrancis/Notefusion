namespace NoteFusion.Application.Preview;

/// <summary>
/// The website's try-it-free preview: how much of a clip is transcribed, and how many previews a
/// browser or an address gets a day before being asked to sign up. The address ceiling is loose on
/// purpose — a carrier NAT puts a city behind one IP — and is only there to bound worker time.
/// </summary>
public static class PreviewLimits
{
    public const double Seconds = 30;
    public const int PerDevicePerDay = 5;
    public const int PerAddressPerDay = 60;
}
