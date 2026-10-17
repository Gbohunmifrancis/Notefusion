using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using NoteFusion.Api.Middleware;

namespace NoteFusion.Tests.Api;

/// <summary>
/// The read-only switch used while moving to another server: reads pass, every write gets a 503 with a
/// plain sentence and Retry-After (which the clients treat as "try again", keeping the session), and the
/// switch itself can only ever be turned on by a clear yes.
/// </summary>
public class MaintenanceModeTests
{
    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    public async Task Reads_go_through(string method)
    {
        var reached = false;
        var middleware = new MaintenanceModeMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext();
        context.Request.Method = method;

        await middleware.InvokeAsync(context);

        Assert.True(reached);
        Assert.Equal(200, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Writes_are_refused_with_a_plain_503(string method)
    {
        var reached = false;
        var middleware = new MaintenanceModeMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(context);

        Assert.False(reached);
        Assert.Equal(503, context.Response.StatusCode);
        Assert.Equal("120", context.Response.Headers.RetryAfter.ToString());

        context.Response.Body.Position = 0;
        using var json = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal("MAINTENANCE_READ_ONLY", json.RootElement.GetProperty("code").GetString());
        Assert.Contains("moving to a new home", json.RootElement.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("1", true)]
    [InlineData(" yes ", true)]
    [InlineData("false", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("maybe", false)]
    public void Only_a_clear_yes_turns_it_on(string? value, bool expected)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Maintenance:ReadOnly"] = value })
            .Build();

        Assert.Equal(expected, MaintenanceModeMiddleware.IsEnabled(config));
    }
}
