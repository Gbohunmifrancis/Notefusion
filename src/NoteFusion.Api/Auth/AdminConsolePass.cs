using NoteFusion.Application.Admin.PhoneLock;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Auth;

/// <summary>
/// An admin signing in to the console with the password or a passkey has just given the very proof that unlocks it, so
/// the sign-in's answer carries the console's first pass in <see cref="AdminPhoneLockRules.Header"/> (exposed to the
/// console by CORS) rather than asking twice. The phone app's sign-in gets none: its pass comes from its own key.
/// </summary>
public static class AdminConsolePass
{
    public static void Attach(HttpContext http, LoginResponse signedIn, IAdminPhoneLock passes, IClientApp client, IDateTimeProvider clock)
    {
        if (signedIn.User.Role != nameof(UserRole.Admin) || client.Current == ClientKinds.App)
            return;

        var session = passes.Open(signedIn.User.Id, null, clock.UtcNow);
        http.Response.Headers[AdminPhoneLockRules.Header] = session.Token;
    }
}
