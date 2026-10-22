using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Devices.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>Push-device registration (expo push tokens) for the current user.</summary>
[Authorize]
public sealed class DevicesController : ApiControllerBase
{
    private readonly ISender _sender;

    public DevicesController(ISender sender) => _sender = sender;

    /// <summary>Registers (or refreshes) an expo push token for the current user's device.</summary>
    [HttpPost]
    [NoActivity]
    public async Task<IActionResult> Register(RegisterDeviceCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>
    /// Drops this device's push token, so the server stops sending to it. The token travels in the
    /// body rather than the route: an expo token is <c>ExponentPushToken[…]</c>, and those brackets
    /// are a poor fit for a path segment.
    /// </summary>
    [HttpDelete]
    public async Task<IActionResult> Unregister(UnregisterDeviceCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
