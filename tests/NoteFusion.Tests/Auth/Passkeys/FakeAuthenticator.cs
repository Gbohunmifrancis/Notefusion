using System.Formats.Cbor;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NoteFusion.Tests.Auth.Passkeys;

/// <summary>
/// A software WebAuthn authenticator: a real P-256 key making real ES256 attestations ("none" format) and
/// assertions, so the verification path the tests drive is Fido2NetLib's own, byte for byte.
/// </summary>
/// <remarks>
/// It answers the options JSON the API hands out the way a browser plus platform authenticator would,
/// producing the PublicKeyCredential JSON the console posts back.
/// </remarks>
public sealed class FakeAuthenticator : IDisposable
{
    private const byte UserPresent = 0x01;
    private const byte UserVerified = 0x04;
    private const byte AttestedCredentialData = 0x40;

    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public FakeAuthenticator(string origin, string rpId, byte[]? credentialId = null)
    {
        Origin = origin;
        RpId = rpId;
        CredentialId = credentialId ?? RandomNumberGenerator.GetBytes(32);
    }

    /// <summary>The page the "browser" is on, written into clientDataJSON.</summary>
    public string Origin { get; set; }

    /// <summary>The RP id hashed into authenticatorData.</summary>
    public string RpId { get; set; }

    public byte[] CredentialId { get; }

    /// <summary>The user handle the credential was created for (from the creation options).</summary>
    public byte[] UserHandle { get; set; } = [];

    /// <summary>The signature counter; each assertion adds one before signing unless told otherwise.</summary>
    public uint Counter { get; set; }

    /// <summary>Whether the authenticator reports that it verified the user (PIN / biometric).</summary>
    public bool VerifiesUser { get; set; } = true;

    public static readonly Guid Aaguid = Guid.Parse("f8a011f3-8c0a-4d15-8006-17111f9edc7d");

    /// <summary>The credential's public key as COSE, as stored on registration.</summary>
    public byte[] CosePublicKey()
    {
        var q = _key.ExportParameters(false).Q;
        var writer = new CborWriter(CborConformanceMode.Ctap2Canonical);
        writer.WriteStartMap(5);
        writer.WriteInt32(1); writer.WriteInt32(2);   // kty: EC2
        writer.WriteInt32(3); writer.WriteInt32(-7);  // alg: ES256
        writer.WriteInt32(-1); writer.WriteInt32(1);  // crv: P-256
        writer.WriteInt32(-2); writer.WriteByteString(q.X!);
        writer.WriteInt32(-3); writer.WriteByteString(q.Y!);
        writer.WriteEndMap();
        return writer.Encode();
    }

    /// <summary>navigator.credentials.create: the attestation response for <paramref name="options"/>.</summary>
    public JsonElement Create(JsonElement options)
    {
        var challenge = options.GetProperty("challenge").GetString()!;
        UserHandle = FromBase64Url(options.GetProperty("user").GetProperty("id").GetString()!);

        var clientData = ClientData("webauthn.create", challenge);

        var authData = new List<byte>();
        authData.AddRange(SHA256.HashData(Encoding.UTF8.GetBytes(RpId)));
        authData.Add((byte)(UserPresent | (VerifiesUser ? UserVerified : 0) | AttestedCredentialData));
        authData.AddRange(BigEndian(Counter));
        authData.AddRange(Aaguid.ToByteArray(bigEndian: true));
        authData.Add((byte)(CredentialId.Length >> 8));
        authData.Add((byte)CredentialId.Length);
        authData.AddRange(CredentialId);
        authData.AddRange(CosePublicKey());

        var writer = new CborWriter(CborConformanceMode.Ctap2Canonical);
        writer.WriteStartMap(3);
        writer.WriteTextString("fmt"); writer.WriteTextString("none");
        writer.WriteTextString("attStmt"); writer.WriteStartMap(0); writer.WriteEndMap();
        writer.WriteTextString("authData"); writer.WriteByteString(authData.ToArray());
        writer.WriteEndMap();

        return Credential(new JsonObject
        {
            ["attestationObject"] = Base64Url(writer.Encode()),
            ["clientDataJSON"] = Base64Url(clientData),
            ["transports"] = new JsonArray("internal", "hybrid"),
        });
    }

    /// <summary>navigator.credentials.get: an assertion answering <paramref name="options"/>.</summary>
    public JsonElement Get(JsonElement options, uint? counter = null)
    {
        Counter = counter ?? Counter + 1;
        var challenge = options.GetProperty("challenge").GetString()!;
        var clientData = ClientData("webauthn.get", challenge);

        var authData = new List<byte>();
        authData.AddRange(SHA256.HashData(Encoding.UTF8.GetBytes(RpId)));
        authData.Add((byte)(UserPresent | (VerifiesUser ? UserVerified : 0)));
        authData.AddRange(BigEndian(Counter));
        var authenticatorData = authData.ToArray();

        var signed = authenticatorData.Concat(SHA256.HashData(clientData)).ToArray();
        var signature = _key.SignData(signed, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);

        return Credential(new JsonObject
        {
            ["authenticatorData"] = Base64Url(authenticatorData),
            ["clientDataJSON"] = Base64Url(clientData),
            ["signature"] = Base64Url(signature),
            ["userHandle"] = Base64Url(UserHandle),
        });
    }

    private JsonElement Credential(JsonObject response)
    {
        var id = Base64Url(CredentialId);
        var credential = new JsonObject
        {
            ["id"] = id,
            ["rawId"] = id,
            ["type"] = "public-key",
            ["response"] = response,
            ["clientExtensionResults"] = new JsonObject(),
        };
        return JsonDocument.Parse(credential.ToJsonString()).RootElement.Clone();
    }

    private byte[] ClientData(string type, string challenge)
        => Encoding.UTF8.GetBytes(new JsonObject
        {
            ["type"] = type,
            ["challenge"] = challenge,
            ["origin"] = Origin,
            ["crossOrigin"] = false,
        }.ToJsonString());

    private static byte[] BigEndian(uint value)
        => [(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value];

    public static string Base64Url(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] FromBase64Url(string text)
    {
        var padded = text.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(padded.PadRight(padded.Length + (4 - padded.Length % 4) % 4, '='));
    }

    public void Dispose() => _key.Dispose();
}
