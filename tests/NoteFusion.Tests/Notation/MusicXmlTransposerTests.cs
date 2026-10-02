using System.Xml.Linq;
using NoteFusion.Core.Notation;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Notation;

/// <summary>
/// Transpose for a choir's range moves every pitch and respells it for the new key; the key
/// signature follows. This is the engraved side of the one edit that does change the notes.
/// </summary>
public class MusicXmlTransposerTests
{
    private const string Score = """
        <?xml version="1.0" encoding="UTF-8"?>
        <score-partwise version="4.0">
          <part id="P1">
            <measure number="1">
              <attributes><divisions>2</divisions><key><fifths>0</fifths><mode>major</mode></key></attributes>
              <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
              <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><accidental>natural</accidental></note>
              <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration><type>quarter</type></note>
              <note><rest/><duration>2</duration><type>quarter</type></note>
            </measure>
          </part>
        </score-partwise>
        """;

    private static List<(string Step, int Alter, int Octave)> Pitches(string xml)
        => XDocument.Parse(xml).Descendants("pitch")
            .Select(p => (
                p.Element("step")!.Value,
                int.TryParse(p.Element("alter")?.Value, out var a) ? a : 0,
                int.Parse(p.Element("octave")!.Value)))
            .ToList();

    [Fact]
    public void Up_a_major_third_into_a_sharp_key_spells_with_sharps()
    {
        var up = MusicXmlTransposer.Transpose(Score, 4, new MusicalKey(4, KeyMode.Major)); // C -> E major

        Assert.Equal([("E", 0, 4), ("G", 1, 4), ("D", 0, 4)], Pitches(up));
        Assert.Equal("4", XDocument.Parse(up).Descendants("fifths").Single().Value);
        Assert.Empty(XDocument.Parse(up).Descendants("accidental")); // the old spelling's marks are gone
        Assert.Single(XDocument.Parse(up).Descendants("rest"));      // rests are untouched
    }

    [Fact]
    public void Down_into_a_flat_key_spells_with_flats_and_crosses_the_octave()
    {
        var down = MusicXmlTransposer.Transpose(Score, -2, new MusicalKey(10, KeyMode.Major)); // C -> Bb major

        Assert.Equal([("B", -1, 3), ("D", 0, 4), ("A", -1, 3)], Pitches(down));
        Assert.Equal("-2", XDocument.Parse(down).Descendants("fifths").Single().Value);
    }

    [Fact]
    public void A_minor_key_takes_its_relative_majors_signature()
    {
        Assert.Equal(0, MusicXmlTransposer.Fifths(new MusicalKey(9, KeyMode.Minor)));  // A minor
        Assert.Equal(-3, MusicXmlTransposer.Fifths(new MusicalKey(0, KeyMode.Minor))); // C minor
        Assert.Equal(6, MusicXmlTransposer.Fifths(new MusicalKey(6, KeyMode.Major)));  // F# major
    }

    [Fact]
    public void Zero_semitones_rewrites_only_the_key_signature()
    {
        var relabelled = MusicXmlTransposer.Transpose(Score, 0, new MusicalKey(9, KeyMode.Minor));

        Assert.Equal(Pitches(Score), Pitches(relabelled));
        Assert.Equal("0", XDocument.Parse(relabelled).Descendants("fifths").Single().Value);
    }

    [Fact]
    public void A_doctype_is_tolerated_and_not_fetched()
    {
        var withDoctype = Score.Replace("<score-partwise",
            "<!DOCTYPE score-partwise PUBLIC \"-//Recordare//DTD MusicXML 4.0 Partwise//EN\" \"http://www.musicxml.org/dtds/partwise.dtd\">\n<score-partwise");
        var up = MusicXmlTransposer.Transpose(withDoctype, 1, new MusicalKey(1, KeyMode.Major));
        Assert.Equal([("D", -1, 4), ("F", 0, 4), ("B", 0, 3)], Pitches(up));
    }

    [Fact]
    public void Malformed_xml_throws_rather_than_returning_a_stale_score()
    {
        Assert.ThrowsAny<System.Xml.XmlException>(() => MusicXmlTransposer.Transpose("<score-partwise><part>", 2, new MusicalKey(2, KeyMode.Major)));
    }
}
