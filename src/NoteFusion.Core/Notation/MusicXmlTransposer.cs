using System.Text;
using System.Xml;
using System.Xml.Linq;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Notation;

/// <summary>
/// Moves a MusicXML score by a number of semitones. Every pitch is respelled for the new key
/// (sharps in sharp keys, flats in flat keys) and every key signature is rewritten, so the
/// engraving matches the note list after a "transpose for my choir" (the one edit that does
/// change the notes — a key override alone never does, F-03).
/// </summary>
public static class MusicXmlTransposer
{
    private static readonly string[] SharpSteps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    private static readonly int[] SharpAlters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    private static readonly string[] FlatSteps = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"];
    private static readonly int[] FlatAlters = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];
    private static readonly int[] MajorFifths = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

    private static readonly IReadOnlyDictionary<string, int> StepPitchClass = new Dictionary<string, int>
    {
        ["C"] = 0, ["D"] = 2, ["E"] = 4, ["F"] = 5, ["G"] = 7, ["A"] = 9, ["B"] = 11
    };

    /// <summary>Key-signature fifths (−7…7) for a key; a minor key takes its relative major's.</summary>
    public static int Fifths(MusicalKey key)
    {
        Guard.NotNull(key);
        int majorTonic = key.Mode == KeyMode.Major ? key.TonicPitchClass : (key.TonicPitchClass + 3) % 12;
        return MajorFifths[majorTonic];
    }

    /// <summary>
    /// The score shifted by <paramref name="semitones"/>, spelled for <paramref name="newKey"/>.
    /// Zero semitones still rewrites the key signatures, which is what a relabel-only caller wants
    /// when the stored score was engraved for another key.
    /// </summary>
    /// <exception cref="XmlException">The input is not well-formed XML.</exception>
    public static string Transpose(string musicXml, int semitones, MusicalKey newKey)
    {
        Guard.NotNull(musicXml);
        Guard.InRange(semitones, -24, 24);
        int fifths = Fifths(newKey);
        bool flats = fifths < 0;

        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null };
        XDocument doc;
        using (var reader = XmlReader.Create(new StringReader(musicXml), settings))
            doc = XDocument.Load(reader);

        // Nothing moved: keep the composer's spelling and only rewrite the signatures below.
        foreach (var pitch in semitones == 0 ? [] : doc.Descendants("pitch").ToList())
        {
            string? step = pitch.Element("step")?.Value.Trim().ToUpperInvariant();
            if (step is null || !StepPitchClass.TryGetValue(step, out int stepPc)) continue;
            if (!int.TryParse(pitch.Element("octave")?.Value, out int octave)) continue;
            double.TryParse(pitch.Element("alter")?.Value, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out double alter);

            int midi = (octave + 1) * 12 + stepPc + (int)Math.Round(alter) + semitones;
            midi = Math.Clamp(midi, 0, 127);
            int pc = midi % 12;
            string newStep = flats ? FlatSteps[pc] : SharpSteps[pc];
            int newAlter = flats ? FlatAlters[pc] : SharpAlters[pc];
            int newOctave = midi / 12 - 1;

            pitch.RemoveNodes();
            pitch.Add(new XElement("step", newStep));
            if (newAlter != 0) pitch.Add(new XElement("alter", newAlter));
            pitch.Add(new XElement("octave", newOctave));
        }

        // A written accidental belongs to the old spelling; engravers derive the new one from
        // alter against the new key signature.
        foreach (var accidental in semitones == 0 ? [] : doc.Descendants("accidental").ToList())
            accidental.Remove();

        foreach (var key in doc.Descendants("key"))
        {
            var fifthsEl = key.Element("fifths");
            if (fifthsEl is not null) fifthsEl.Value = fifths.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        var sb = new StringBuilder();
        using (var writer = XmlWriter.Create(sb, new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = false, OmitXmlDeclaration = false }))
            doc.Save(writer);
        return sb.ToString();
    }
}
