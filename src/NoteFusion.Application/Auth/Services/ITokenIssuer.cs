using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Auth.Services;

/// <summary>
/// Issues a new access token plus a rotated refresh token for a user, persisting the hashed refresh
/// token to the change tracker. Callers are responsible for SaveChanges.
/// </summary>
public interface ITokenIssuer
{
    /// <param name="client">
    /// The client the sign-in came from (<see cref="ClientKinds"/>); null reads it off the request. A refresh passes the
    /// spent token's own, so a token keeps the client it was first issued to.
    /// </param>
    TokenPairResponse Issue(User user, string? client = null);
}
