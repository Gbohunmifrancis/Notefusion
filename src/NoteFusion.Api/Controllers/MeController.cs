using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Me.Queries;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>Form request payload for a profile picture upload.</summary>
public sealed class UpdateMyPictureRequest
{
    /// <summary>The new avatar (JPEG, PNG, or WebP).</summary>
    public required IFormFile Image { get; init; }
}

/// <summary>The current user's own profile (F: self-service profile).</summary>
[Authorize]
[Route("api/me")]
public sealed class MeController : ApiControllerBase
{
    private const long MaxPictureBytes = 5 * 1024 * 1024; // 5 MB — generous for a 512px avatar

    /// <summary>
    /// Headroom over <see cref="MaxPictureBytes"/> so an oversized upload trips the check below and
    /// comes back as a branded <c>ApiError</c> the app can display, instead of the bare 413 the
    /// framework returns when the transport limit itself is exceeded.
    /// </summary>
    private const long PictureRequestLimit = MaxPictureBytes + (1024 * 1024);

    private static readonly string[] AllowedPictureTypes = ["image/jpeg", "image/png", "image/webp"];

    private readonly ISender _sender;

    public MeController(ISender sender) => _sender = sender;

    /// <summary>Returns the authenticated user's profile.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetMyProfileQuery(), ct));

    /// <summary>Updates the authenticated user's name and phone number.</summary>
    [HttpPut]
    public async Task<IActionResult> Update(UpdateMyProfileCommand command, CancellationToken ct)
        => HandleResult(await _sender.Send(command, ct));

    /// <summary>
    /// Replaces the authenticated user's profile picture. The upload is proxied through here rather
    /// than sent to the storage provider directly, so no storage credential ships in the app binary.
    /// </summary>
    [HttpPost("picture")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(PictureRequestLimit)]
    public async Task<IActionResult> UpdatePicture(
        [FromForm] UpdateMyPictureRequest request,
        CancellationToken ct)
    {
        var image = request.Image;

        // Zero bytes is not a JPEG/PNG/WebP either, so it shares the format error rather than
        // earning a fourth code the app would have to learn.
        if (image is null || image.Length == 0)
            return HandleResult(Result.Failure<MyProfileDto>(UserErrors.PictureUnsupportedType));

        if (image.Length > MaxPictureBytes)
            return HandleResult(Result.Failure<MyProfileDto>(UserErrors.PictureTooLarge));

        // ContentType arrives as a full media type and may carry parameters ("image/jpeg; …").
        var mediaType = image.ContentType?.Split(';')[0].Trim();
        if (mediaType is null || !AllowedPictureTypes.Contains(mediaType, StringComparer.OrdinalIgnoreCase))
            return HandleResult(Result.Failure<MyProfileDto>(UserErrors.PictureUnsupportedType));

        await using var stream = image.OpenReadStream();
        var command = new UpdateMyProfilePictureCommand(stream, image.FileName);
        return HandleResult(await _sender.Send(command, ct));
    }

    /// <summary>Clears the authenticated user's profile picture, restoring their initials.</summary>
    [HttpDelete("picture")]
    public async Task<IActionResult> RemovePicture(CancellationToken ct)
        => HandleResult(await _sender.Send(new RemoveMyProfilePictureCommand(), ct));

    /// <summary>
    /// Closes the authenticated user's account, taking their library with it. Irreversible;
    /// the current password is re-checked in the handler before anything is removed.
    /// </summary>
    [HttpDelete]
    public async Task<IActionResult> Delete(DeleteMyAccountCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));
}
