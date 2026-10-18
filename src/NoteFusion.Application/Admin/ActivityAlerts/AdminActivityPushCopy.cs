using System.Text.RegularExpressions;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Admin.ActivityAlerts;

/// <summary>An account created since the last run.</summary>
/// <param name="Source">"web" or "mobile" (<c>User.SignupSource</c>); null when not known.</param>
public sealed record SignupFact(Guid UserId, string? Name, string? Source, string? Country);

/// <summary>A transcription submitted since the last run. <paramref name="First"/>: the account's first ever.</summary>
public sealed record TranscriptionFact(Guid UserId, string? Name, TranscriptionJobKind Kind, bool First);

/// <summary>
/// What the admins' activity push says: someone joined, someone is transcribing ("Ada Obi just joined on the app, from
/// Ghana." / "Ada Obi is transcribing a song link."), or one summary for several ("2 sign-ups · 3 transcriptions" over
/// the names). No pronoun names anyone, and the lengths are the payment alert's, so neither line is cut off.
/// </summary>
public static partial class AdminActivityPushCopy
{
    public const int TitleMax = PaymentPushCopy.TitleMax;
    public const int BodyMax = PaymentPushCopy.BodyMax;

    /// <summary>The line when the phone asked for names to be left out.</summary>
    public const string HiddenBody = "Tap to see who.";

    public static PaymentPushWords Summary(
        IReadOnlyList<SignupFact> signups, IReadOnlyList<TranscriptionFact> transcriptions, bool hideNames)
    {
        var people = signups.Select(s => s.UserId).Concat(transcriptions.Select(t => t.UserId)).Distinct().ToList();
        if (people.Count == 1)
            return One(signups.FirstOrDefault(), transcriptions, hideNames);

        var parts = new List<string>();
        if (signups.Count > 0)
            parts.Add(Count(signups.Count, "sign-up"));
        if (transcriptions.Count > 0)
            parts.Add(Count(transcriptions.Count, "transcription"));
        var title = string.Join(" · ", parts);

        if (hideNames)
            return new PaymentPushWords(Clip(title, TitleMax), HiddenBody);

        // Who joined first, then who is transcribing, each once.
        var names = signups.Select(s => (s.UserId, s.Name))
            .Concat(transcriptions.Select(t => (t.UserId, t.Name)))
            .DistinctBy(p => p.UserId)
            .ToList();
        var line = Join(names.Select(p => Name(p.Name)).ToList(), 3);
        if (line.Length > BodyMax)
            line = Join(names.Select(p => FirstName(p.Name)).ToList(), 3);
        if (line.Length > BodyMax)
            line = Join(names.Select(p => FirstName(p.Name)).ToList(), 1);
        return new PaymentPushWords(Clip(title, TitleMax), Clip(line, BodyMax));
    }

    /// <summary>One person: joined, transcribing, or both in the same run.</summary>
    private static PaymentPushWords One(SignupFact? signup, IReadOnlyList<TranscriptionFact> jobs, bool hideNames)
    {
        var title = (signup, jobs.Count) switch
        {
            (not null, 0) => "New sign-up",
            (not null, _) => "New sign-up, transcribing",
            (null, _) when jobs.Any(j => j.First) => "First transcription",
            _ => "Transcribing now",
        };
        if (hideNames)
            return new PaymentPushWords(title, HiddenBody);

        var fullName = signup?.Name ?? jobs[0].Name;
        // Shortest last: a long name drops the country, then goes by its first name, then is clipped.
        foreach (var who in new[] { Name(fullName), FirstName(fullName) })
        {
            foreach (var withCountry in new[] { true, false })
            {
                var line = Sentence(who, signup, jobs, withCountry);
                if (line.Length <= BodyMax)
                    return new PaymentPushWords(title, line);
            }
        }
        return new PaymentPushWords(title, Clip(Sentence(FirstName(fullName), signup, jobs, false), BodyMax));
    }

    private static string Sentence(string who, SignupFact? signup, IReadOnlyList<TranscriptionFact> jobs, bool withCountry)
    {
        var doing = jobs.Count switch
        {
            0 => null,
            1 => $"transcribing {What(jobs[0].Kind)}",
            _ => $"transcribing {jobs.Count} at once",
        };
        if (signup is null)
            return $"{who} is {doing}.";

        var joined = $"{who} just joined{Where(signup.Source)}";
        if (doing is not null)
            return $"{joined} and is {doing}.";
        var country = withCountry ? PaymentPushCopy.CountryName(signup.Country) : null;
        return country is null ? $"{joined}." : $"{joined}, from {country}.";
    }

    private static string What(TranscriptionJobKind kind) => kind switch
    {
        TranscriptionJobKind.Link => "a song link",
        TranscriptionJobKind.Song => "a song",
        _ => "a recording",
    };

    private static string Where(string? source) => source switch
    {
        "mobile" => " on the app",
        "web" => " on the website",
        _ => "",
    };

    private static string Count(int n, string noun) => n == 1 ? $"1 {noun}" : $"{n} {noun}s";

    /// <summary>"A", "A and B", "A, B and C", "A, B and 3 others".</summary>
    private static string Join(IReadOnlyList<string> names, int shown)
    {
        if (names.Count == 1)
            return names[0];
        if (names.Count <= shown)
            return $"{string.Join(", ", names.Take(names.Count - 1))} and {names[^1]}";

        var others = names.Count - (shown - 1);
        var lead = names.Take(Math.Max(1, shown - 1));
        return $"{string.Join(", ", lead)} and {others} others";
    }

    private static string Name(string? fullName)
        => string.IsNullOrWhiteSpace(fullName) ? "Someone" : Spaces().Replace(fullName.Trim(), " ");

    private static string FirstName(string? fullName) => Name(fullName).Split(' ')[0];

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..(max - 1)].TrimEnd() + "…";

    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();
}
