namespace NoteFusion.Core.Enums;

/// <summary>
/// How a singer likes to practise, chosen by them on the Practice screen (wire values "playful" / "focused"). A style,
/// never an age: nothing asks for or stores a birth date. The track picks which drills the day offers and how the
/// clients show a marked take; XP, levels, streaks and badges are the same rules on either, so switching loses nothing.
/// Stored as its name, so the numbers are free to move.
/// </summary>
public enum PracticeTrack
{
    /// <summary>Fun and games: short drills from the lower tiers at a gentler pace, stars and stickers.</summary>
    Playful = 0,

    /// <summary>For serious singers: harder lines (wide leaps, minor with se, sight-singing phrases), exact scores.</summary>
    Focused = 1
}
