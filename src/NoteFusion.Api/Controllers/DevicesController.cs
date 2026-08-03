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
    public async Task<IActionResult> Register(RegisterDeviceCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
