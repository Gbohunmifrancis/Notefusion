using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

/// <summary>The <c>X-Time-Zone</c> a test's request sends; null (none sent, so Africa/Lagos) by default.</summary>
public sealed class StubClientTimeZone : IClientTimeZone
{
    public StubClientTimeZone(string? current = null) => Current = current;

    public string? Current { get; set; }
}
