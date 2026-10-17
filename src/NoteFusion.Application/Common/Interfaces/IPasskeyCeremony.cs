namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The WebAuthn half of passkeys: building the options a browser hands to its authenticator, and checking
/// what comes back (origin, relying party, challenge, user verification, signature, counter). Implemented in
/// Infrastructure over Fido2NetLib, so nothing here names the library.
/// </summary>
/// <remarks>
/// Options and responses cross this boundary as WebAuthn JSON (base64url bytes, the W3C member names),
/// exactly what the browser sends and receives. A <c>null</c> from a verify method is a refusal; the reason
/// is logged by the implementation and never shown to the caller.
/// </remarks>
public interface IPasskeyCeremony
{
    /// <summary>Creation options for <paramref name="user"/>: resident key and user verification required.</summary>
    PasskeyOptions CreateRegistrationOptions(PasskeyUser user, IReadOnlyList<byte[]> excludeCredentialIds);

    /// <summary>Checks an attestation response against the options it answers. Null when it does not verify.</summary>
    Task<VerifiedPasskey?> VerifyRegistrationAsync(string responseJson, string optionsJson, CancellationToken ct);

    /// <summary>Assertion options for a discoverable sign-in (no allow list), user verification required.</summary>
    PasskeyOptions CreateSignInOptions();

    /// <summary>
    /// Checks an assertion against the options it answers and the stored key, including that the counter
    /// moved forward. Returns the authenticator's new counter, or null when it does not verify.
    /// </summary>
    Task<uint?> VerifySignInAsync(string responseJson, string optionsJson, StoredPasskey stored, CancellationToken ct);

    /// <summary>
    /// Reads, without verifying anything, which challenge a response answers and which credential (and user
    /// handle) it names — enough to find the stored options and key. Null when the response is malformed.
    /// </summary>
    PasskeyResponseClaim? ReadResponse(string responseJson);
}

/// <summary>Who a new passkey is for: the WebAuthn user handle is the account id's bytes.</summary>
public sealed record PasskeyUser(Guid Id, string Name, string DisplayName);

/// <summary>Options as WebAuthn JSON, and the base64url challenge inside them (the store's key).</summary>
public sealed record PasskeyOptions(string Challenge, string OptionsJson);

/// <summary>A verified attestation: what is kept of the new credential.</summary>
public sealed record VerifiedPasskey(
    byte[] CredentialId, byte[] PublicKey, uint SignCount, Guid AaGuid, IReadOnlyList<string> Transports);

/// <summary>The stored half of a passkey, as an assertion is checked against it.</summary>
public sealed record StoredPasskey(byte[] CredentialId, byte[] PublicKey, uint SignCount, byte[] UserHandle);

/// <summary>What a response claims before it is verified.</summary>
public sealed record PasskeyResponseClaim(string Challenge, byte[] CredentialId, byte[]? UserHandle);
