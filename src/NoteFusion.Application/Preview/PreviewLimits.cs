namespace NoteFusion.Application.Preview;

/// <summary>
/// The website's try-it-free preview: how much of a clip is transcribed, and how many previews a browser
/// or an address gets before being asked to sign up.
/// </summary>
/// <remarks>
/// One per browser, ever: a preview is a taste, and an account is where the free transcriptions are. It
/// used to be five a day, renewed daily, which was a free tier with no end for anyone who never signed up.
/// The browser id is the visitor's own to clear, so the address ceiling backs it up; it stays above one
/// because a church's Wi-Fi or a carrier NAT puts many people behind a single IP.
/// </remarks>
public static class PreviewLimits
{
    public const double Seconds = 30;
    public const int PerDevice = 1;
    public const int PerAddressPerDay = 10;
}
