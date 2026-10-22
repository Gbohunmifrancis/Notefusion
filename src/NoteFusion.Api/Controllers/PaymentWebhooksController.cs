using System.Text;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// Receives provider payment webhooks. This is the "Receive → Validate Signature → Persist Event"
/// front of the pipeline: the signature is verified against the EXACT raw body BEFORE any business
/// logic, then the event is written to the inbox and a fast 200 is returned. Actual fulfilment happens
/// out-of-band in the webhook worker, so a slow or failing effect never makes the provider retry.
/// Anonymous by design — providers authenticate by signature, not JWT.
/// </summary>
[AllowAnonymous]
[ApiController]
[Route("api/billing/webhooks")]
[Route("api/webhooks")]
public sealed class PaymentWebhooksController : ControllerBase
{
    private readonly ISender _sender;
    private readonly IReadOnlyDictionary<PaymentProvider, IPaymentWebhookValidator> _validators;

    internal const long MaxBodyBytes = 256 * 1024;

    public PaymentWebhooksController(ISender sender, IEnumerable<IPaymentWebhookValidator> validators)
    {
        _sender = sender;
        _validators = validators.ToDictionary(v => v.Provider);
    }

    /// <summary>Ingests a webhook for <paramref name="provider"/> (e.g. <c>paystack</c>).</summary>
    /// <remarks>
    /// Capped well above any provider's event (a few KB): the body is read and hashed before the signature
    /// can refuse it, so without a cap anyone could make the server buffer the 30 MB default per request.
    /// </remarks>
    [HttpPost("{provider}")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Receive(string provider, CancellationToken ct)
    {
        if (!Enum.TryParse<PaymentProvider>(provider, ignoreCase: true, out var parsed)
            || !_validators.TryGetValue(parsed, out var validator))
        {
            return NotFound();
        }

        // Read the body verbatim, as bytes. Signatures are byte-exact, so we must NOT let model binding
        // re-serialize it — that is why there is no [FromBody] parameter here — and the validator is handed
        // the bytes themselves, not a string decoded from them.
        byte[] rawBytes;
        using (var buffer = new MemoryStream())
        {
            await Request.Body.CopyToAsync(buffer, ct);
            rawBytes = buffer.ToArray();
        }
        var rawBody = Encoding.UTF8.GetString(rawBytes);

        var headers = Request.Headers.ToDictionary(
            h => h.Key, h => h.Value.ToString(), StringComparer.OrdinalIgnoreCase);

        // Validate signature FIRST. An unsigned or mis-signed request never reaches the inbox.
        var validation = validator.Validate(new WebhookRequest(rawBody, headers, rawBytes));
        if (validation.IsFailure)
            return StatusCode(ApiControllerBase.StatusFor(validation.Error.Type), new ApiError(validation.Error.Code, validation.Error.Message));

        var message = validation.Value;

        var ingest = await _sender.Send(
            new IngestWebhookCommand(
                parsed, message.ProviderEventId, message.EventType, message.PaymentReference, rawBody, message.Settles),
            ct);

        // A persisted event (including a recognised duplicate) is a 200 so the provider stops retrying;
        // the worker takes it from here. One we could not store is our failure, not the provider's: a 503,
        // which every provider retries, where a 4xx would make them drop a delivery we never kept.
        return ingest.IsSuccess
            ? Ok(new { received = true })
            : StatusCode(StatusCodes.Status503ServiceUnavailable, new ApiError(ingest.Error.Code, ingest.Error.Message));
    }
}
