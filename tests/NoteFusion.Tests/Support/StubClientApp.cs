using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Tests.Support;

public sealed class StubClientApp : IClientApp
{
    public StubClientApp(string? current = "web") => Current = current;

    public string? Current { get; set; }
}
