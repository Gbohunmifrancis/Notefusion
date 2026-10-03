using System.Text;
using System.Xml;
using System.Xml.Linq;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Notation;

/// <summary>
/// Moves a MusicXML score by a number of semitones. Every pitch is respelled for the new key
/// (sharps in sharp keys, flats in flat keys), every chord symbol (<c>&lt;harmony&gt;</c>) is moved
/// and named for the new key as <see cref="ChordSpeller"/> names it, and every key signature is
/// rewritten, so the engraving matches the note list after a "transpose for my choir" (the one edit
/// that does change the notes — a key override alone never does, F-03).
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

        // Chord symbols move with the notes and take the same names as the sheet's chord list.
        foreach (var harmony in semitones == 0 ? [] : doc.Descendants("harmony").ToList())
        {
            var root = harmony.Element("root");
            if (root is null || ReadPitchClass(root, "root") is not { } rootPc) continue;
            int newRoot = ((rootPc + semitones) % 12 + 12) % 12;
            bool diminished = harmony.Element("kind")?.Value.Trim() == "diminished";
            string rootName = ChordSpeller.SpellRoot(newRoot, newKey, sharp: diminished);
            WritePitch(root, "root", rootName);

            var bass = harmony.Element("bass");
            if (bass is not null && ReadPitchClass(bass, "bass") is { } bassPc)
                WritePitch(bass, "bass", ChordSpeller.SpellTone(rootName, newRoot, ((bassPc + semitones) % 12 + 12) % 12));
        }

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

    /// <summary>The pitch class a harmony's <c>root</c> or <c>bass</c> names (step + alter), or null when it names none.</summary>
    private static int? ReadPitchClass(XElement element, string prefix)
    {
        string? step = element.Element(prefix + "-step")?.Value.Trim().ToUpperInvariant();
        if (step is null || !StepPitchClass.TryGetValue(step, out int stepPc)) return null;
        double.TryParse(element.Element(prefix + "-alter")?.Value, System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out double alter);
        return ((stepPc + (int)Math.Round(alter)) % 12 + 12) % 12;
    }

    /// <summary>Writes a letter name ("Bb", "F#", "D") as a harmony's step and alter.</summary>
    private static void WritePitch(XElement element, string prefix, string name)
    {
        var step = element.Element(prefix + "-step")!;
        step.Value = name[..1];
        element.Element(prefix + "-alter")?.Remove();
        if (name.Length > 1)
            step.AddAfterSelf(new XElement(prefix + "-alter", name[1] == '#' ? 1 : -1));
    }
}
