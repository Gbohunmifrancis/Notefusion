using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Infrastructure.Push;
using NSubstitute;

namespace NoteFusion.Tests.Push;

/// <summary>
/// Push runs at the end of job completion, so a slow or absent Expo must never surface as an exception there.
/// </summary>
public class ExpoPushSenderTests
{
    private static readonly Guid User = Guid.NewGuid();

    [Fact]
    public async Task A_timeout_from_expo_is_logged_not_thrown()
    {
        var sender = Sender(new ThrowingHandler(new TaskCanceledException("The request timed out.")));

        await sender.SendAsync([User], new PushMessage("Your sheet is ready", "Tap to open it"));
    }

    [Fact]
    public async Task An_unreachable_expo_is_logged_not_thrown()
    {
        var sender = Sender(new ThrowingHandler(new HttpRequestException("No route to host")));

        await sender.SendAsync([User], new PushMessage("Your sheet is ready", "Tap to open it"));
    }

    [Fact]
    public async Task The_callers_own_cancellation_still_cancels()
    {
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        var sender = Sender(new ThrowingHandler(new TaskCanceledException()));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            sender.SendAsync([User], new PushMessage("t", "b"), cts.Token));
    }

    private static ExpoPushSender Sender(HttpMessageHandler handler)
    {
        var tokens = Substitute.For<IDeviceTokenService>();
        tokens.ResolveTokensAsync(Arg.Any<IReadOnlyList<Guid>>(), Arg.Any<CancellationToken>())
            .Returns(["ExponentPushToken[abc]"]);
        return new ExpoPushSender(tokens, NullLogger<ExpoPushSender>.Instance, new HttpClient(handler));
    }

    private sealed class ThrowingHandler(Exception ex) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromException<HttpResponseMessage>(ex);
    }
}
