using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Activity;

/// <summary>The client a request came from, as the activity log names it: "phone" or "web", null when unknown.</summary>
public static class ActivityClient
{
    public static string? From(string? clientKind) => clientKind switch
    {
        ClientKinds.App => "phone",
        ClientKinds.Web => "web",
        _ => null,
    };
}
