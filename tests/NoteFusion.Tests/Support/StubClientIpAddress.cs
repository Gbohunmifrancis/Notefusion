using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

/// <summary>
/// An <see cref="IClientIpAddress"/> that answers whatever a test sets, and null by default — which is
/// what production answers for a local run, a compose run, or any background job, because the real
/// resolver keeps only publicly routable addresses. Defaulting to an address would leave "we do not
/// know" untested, and that is the case the trail has to record honestly.
/// </summary>
public sealed class StubClientIpAddress : IClientIpAddress
{
    public StubClientIpAddress(string? current = null) => Current = current;

    public string? Current { get; set; }
}
