namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Hashes and verifies secrets (passwords and refresh tokens) using bcrypt.</summary>
public interface IPasswordHasher
{
    string Hash(string plainText);
    bool Verify(string plainText, string hash);
}
