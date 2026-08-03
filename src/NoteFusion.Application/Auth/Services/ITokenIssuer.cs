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
    TokenPairResponse Issue(User user);
}
