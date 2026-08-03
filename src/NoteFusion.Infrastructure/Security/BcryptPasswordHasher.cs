using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security;

/// <summary>
/// bcrypt hasher (work factor 12) for passwords and refresh-token secrets. <see cref="Verify"/>
/// swallows malformed-hash exceptions and returns false so a corrupt stored value can never throw
/// its way into an auth decision.
/// </summary>
public sealed class BcryptPasswordHasher : IPasswordHasher
{
    private const int WorkFactor = 12;

    public string Hash(string plainText) => BCrypt.Net.BCrypt.HashPassword(plainText, WorkFactor);

    public bool Verify(string plainText, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(plainText, hash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            return false;
        }
    }
}
