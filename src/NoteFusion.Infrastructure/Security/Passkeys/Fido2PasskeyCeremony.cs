using System.Text.Json;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security.Passkeys;

/// <summary>
/// <see cref="IPasskeyCeremony"/> over Fido2NetLib. Attestation is not requested ("none"): the console
/// needs to know the key, not vouch for the make of the authenticator, and asking would prompt some
/// browsers for consent.
/// </summary>
/// <remarks>
/// Every refusal is logged with the library's reason and returned as null; the handler turns that into a
/// plain sentence, so no library or browser text reaches a screen.
/// </remarks>
public sealed class Fido2PasskeyCeremony : IPasskeyCeremony
{
    private readonly IFido2 _fido2;
    private readonly ILogger<Fido2PasskeyCeremony> _logger;

    public Fido2PasskeyCeremony(PasskeySettings settings, ILogger<Fido2PasskeyCeremony> logger)
    {
        _logger = logger;
        _fido2 = new Fido2(new Fido2Configuration
        {
            RPID = settings.RpId,
            RPName = settings.RpName,
            Origins = new HashSet<string>(settings.Origins, StringComparer.OrdinalIgnoreCase),
            // Milliseconds; the same window the server keeps the challenge for.
            Timeout = (uint)PasskeyChallenge.Lifetime.TotalMilliseconds,
            // The library's default is the spec's floor (16 bytes); a challenge is also the store's key.
            ChallengeSize = 32,
        }, metadataService: null);
    }

    public PasskeyOptions CreateRegistrationOptions(PasskeyUser user, IReadOnlyList<byte[]> excludeCredentialIds)
    {
        var options = _fido2.RequestNewCredential(new RequestNewCredentialParams
        {
            User = new Fido2User { Id = user.Id.ToByteArray(), Name = user.Name, DisplayName = user.DisplayName },
            ExcludeCredentials = excludeCredentialIds.Select(id => new PublicKeyCredentialDescriptor(id)).ToList(),
            AuthenticatorSelection = new AuthenticatorSelection
            {
                ResidentKey = ResidentKeyRequirement.Required,
                UserVerification = UserVerificationRequirement.Required,
            },
            AttestationPreference = AttestationConveyancePreference.None,
        });

        return new PasskeyOptions(Base64Url(options.Challenge), options.ToJson());
    }

    public async Task<VerifiedPasskey?> VerifyRegistrationAsync(string responseJson, string optionsJson, CancellationToken ct)
    {
        try
        {
            var response = JsonSerializer.Deserialize<AuthenticatorAttestationRawResponse>(responseJson);
            if (response is null) return null;

            var credential = await _fido2.MakeNewCredentialAsync(new MakeNewCredentialParams
            {
                AttestationResponse = response,
                OriginalOptions = CredentialCreateOptions.FromJson(optionsJson),
                // Uniqueness is the handler's check, against the database, after verification.
                IsCredentialIdUniqueToUserCallback = (_, _) => Task.FromResult(true),
            }, ct);

            return new VerifiedPasskey(
                credential.Id,
                credential.PublicKey,
                credential.SignCount,
                credential.AaGuid,
                (credential.Transports ?? []).Select(TransportName).ToList());
        }
        catch (Exception ex) when (ex is Fido2VerificationException or JsonException or FormatException
                                       or ArgumentException or InvalidOperationException)
        {
            _logger.LogWarning("Passkey registration refused: {Reason}", Describe(ex));
            return null;
        }
    }

    public PasskeyOptions CreateSignInOptions()
    {
        var options = _fido2.GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = [],
            UserVerification = UserVerificationRequirement.Required,
        });

        return new PasskeyOptions(Base64Url(options.Challenge), options.ToJson());
    }

    public async Task<uint?> VerifySignInAsync(
        string responseJson, string optionsJson, StoredPasskey stored, CancellationToken ct)
    {
        try
        {
            var response = JsonSerializer.Deserialize<AuthenticatorAssertionRawResponse>(responseJson);
            if (response is null) return null;

            var result = await _fido2.MakeAssertionAsync(new MakeAssertionParams
            {
                AssertionResponse = response,
                OriginalOptions = AssertionOptions.FromJson(optionsJson),
                StoredPublicKey = stored.PublicKey,
                // The library refuses a counter at or below this one (unless both are zero).
                StoredSignatureCounter = stored.SignCount,
                IsUserHandleOwnerOfCredentialIdCallback = (args, _) => Task.FromResult(
                    args.UserHandle.AsSpan().SequenceEqual(stored.UserHandle)
                    && args.CredentialId.AsSpan().SequenceEqual(stored.CredentialId)),
            }, ct);

            return result.SignCount;
        }
        catch (Fido2VerificationException ex) when (ex.Code == Fido2NetLib.Exceptions.Fido2ErrorCode.InvalidSignCount)
        {
            // The authenticator's counter went backwards: the WebAuthn sign of a cloned key.
            _logger.LogWarning("Passkey sign-in refused: the signature counter did not advance (possible cloned authenticator).");
            return null;
        }
        catch (Exception ex) when (ex is Fido2VerificationException or JsonException or FormatException
                                       or ArgumentException or InvalidOperationException)
        {
            _logger.LogWarning("Passkey sign-in refused: {Reason}", Describe(ex));
            return null;
        }
    }

    public PasskeyResponseClaim? ReadResponse(string responseJson)
    {
        try
        {
            using var document = JsonDocument.Parse(responseJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("response", out var response)
                || response.ValueKind != JsonValueKind.Object
                || !response.TryGetProperty("clientDataJSON", out var clientDataText))
                return null;

            var idText = root.TryGetProperty("rawId", out var rawId) ? rawId.GetString()
                : root.TryGetProperty("id", out var id) ? id.GetString() : null;
            if (string.IsNullOrEmpty(idText)) return null;

            using var clientData = JsonDocument.Parse(FromBase64Url(clientDataText.GetString() ?? string.Empty));
            if (!clientData.RootElement.TryGetProperty("challenge", out var challenge)
                || challenge.GetString() is not { Length: > 0 } challengeText)
                return null;

            byte[]? userHandle = null;
            if (response.TryGetProperty("userHandle", out var handle) && handle.GetString() is { Length: > 0 } handleText)
                userHandle = FromBase64Url(handleText);

            return new PasskeyResponseClaim(challengeText, FromBase64Url(idText), userHandle);
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException)
        {
            return null;
        }
    }

    private static string TransportName(AuthenticatorTransport transport) => transport switch
    {
        AuthenticatorTransport.Usb => "usb",
        AuthenticatorTransport.Nfc => "nfc",
        AuthenticatorTransport.Ble => "ble",
        AuthenticatorTransport.SmartCard => "smart-card",
        AuthenticatorTransport.Hybrid => "hybrid",
        AuthenticatorTransport.Internal => "internal",
        _ => transport.ToString().ToLowerInvariant(),
    };

    private static string Describe(Exception ex)
        => ex is Fido2VerificationException fido ? $"{fido.Code}: {fido.Message}" : $"{ex.GetType().Name}: {ex.Message}";

    internal static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static byte[] FromBase64Url(string text)
    {
        var padded = text.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '=');
        return Convert.FromBase64String(padded);
    }
}
