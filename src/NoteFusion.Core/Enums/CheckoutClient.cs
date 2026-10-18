namespace NoteFusion.Core.Enums;

/// <summary>
/// Which client opened a checkout: the phone app (the provider returns to its deep link) or the website (the
/// provider returns to the site's own page). Stored by name on <c>PaymentTransaction</c>.
/// </summary>
public enum CheckoutClient
{
    Phone = 0,
    Web = 1
}
