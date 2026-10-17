namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The time zone the client says it is in (<c>X-Time-Zone</c>: an IANA name such as "Africa/Lagos", or a UTC
/// offset such as "+01:00"), raw and unchecked; null when none was sent. Read by practice, whose streaks run on
/// the singer's own calendar (<see cref="Practice.PracticeTime"/> turns it into a zone).
/// </summary>
public interface IClientTimeZone
{
    string? Current { get; }
}
