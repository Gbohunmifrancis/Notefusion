using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One row per handset that has ever spent a free generation, and where it was when it did. The free-tier
/// ceiling itself is enforced from the device stamp on <see cref="TranscriptionJob"/> — this is the
/// register that makes the enforcement legible: which country a device first appeared from, which address,
/// and whether it has since moved.
/// </summary>
/// <remarks>
/// <para>
/// Location is recorded here and never gates anything, because it cannot: the two Google accounts this
/// feature exists to stop share one phone, so they share an address and a country too. What it does buy is
/// the ability to see farming rather than merely block it — one device, several accounts, and a country
/// that keeps changing is a rotating VPN, and that pattern is invisible without somewhere to write it down.
/// </para>
/// <para>
/// Nothing here is a ceiling on an address. A single Nigerian carrier NAT puts thousands of unrelated
/// people behind one IP, and refusing a genuine first-time user their free trial is a worse failure than
/// the farming it would prevent — silent, and not the sort of thing anyone reports.
/// </para>
/// </remarks>
public class TrialDevice : BaseEntity
{
    private TrialDevice() { } // EF Core

    /// <summary>
    /// The device, as an opaque hash of what the client claimed. Unique — this table is the device.
    /// </summary>
    public string Fingerprint { get; private set; } = string.Empty;

    public DateTime FirstSeenAtUtc { get; private set; }

    /// <summary>Refreshed on every submit from this device, so a dormant device is distinguishable.</summary>
    public DateTime LastSeenAtUtc { get; private set; }

    /// <summary>
    /// Where the device was when it first spent a generation, ISO alpha-2. Null when the lookup was off or
    /// failed, which is a legitimate state and not an error — see <c>GeoSettings.LookupUrl</c>.
    /// </summary>
    /// <remarks>
    /// First observation wins, mirroring <see cref="User.RecordCountry"/>: it makes this safe to write
    /// repeatedly, and it means a device that travels is never retroactively relabelled as having always
    /// been somewhere else.
    /// </remarks>
    public string? FirstSeenCountry { get; private set; }

    /// <summary>
    /// The most recent country observed for this device. Equal to <see cref="FirstSeenCountry"/> for the
    /// overwhelming majority; the interesting case is when it is not.
    /// </summary>
    public string? LastSeenCountry { get; private set; }

    /// <summary>
    /// The address the device first appeared from, for the record. Not refreshed: a phone moves between
    /// cell and wifi several times an hour, so a changing address carries no information worth the write.
    /// </summary>
    public string? FirstSeenIp { get; private set; }

    public static TrialDevice Register(string fingerprint, string? country, string? ip, DateTime utcNow)
    {
        var code = NormaliseCountry(country);
        return new TrialDevice
        {
            Id = Guid.NewGuid(),
            Fingerprint = Guard.NotNullOrWhiteSpace(fingerprint),
            FirstSeenAtUtc = utcNow,
            LastSeenAtUtc = utcNow,
            FirstSeenCountry = code,
            LastSeenCountry = code,
            FirstSeenIp = string.IsNullOrWhiteSpace(ip) ? null : ip.Trim()
        };
    }

    /// <summary>Notes that the device is still in use.</summary>
    public void Observe(DateTime utcNow) => LastSeenAtUtc = utcNow;

    /// <summary>
    /// Takes a fresh country reading. Returns true when the device is somewhere other than where it was
    /// first seen — the caller's cue that this is worth a line in the log. Blank or malformed input is
    /// ignored rather than stored, because "we do not know" and "somewhere else" must not look alike.
    /// </summary>
    public bool ObserveCountry(string? isoAlpha2, DateTime utcNow)
    {
        LastSeenAtUtc = utcNow;

        var code = NormaliseCountry(isoAlpha2);
        if (code is null) return false;

        FirstSeenCountry ??= code;
        LastSeenCountry = code;

        return code != FirstSeenCountry;
    }

    /// <summary>The same rule <see cref="User.RecordCountry"/> applies, for the same reasons.</summary>
    private static string? NormaliseCountry(string? isoAlpha2)
    {
        var code = isoAlpha2?.Trim().ToUpperInvariant();
        return code is { Length: 2 } && code.All(char.IsAsciiLetterUpper) ? code : null;
    }
}
