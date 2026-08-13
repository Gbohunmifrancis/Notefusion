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
public sealed class PaymentWebhooksController : ControllerBase
{
    private readonly ISender _sender;
    private readonly IReadOnlyDictionary<PaymentProvider, IPaymentWebhookValidator> _validators;

    public PaymentWebhooksController(ISender sender, IEnumerable<IPaymentWebhookValidator> validators)
    {
        _sender = sender;
        _validators = validators.ToDictionary(v => v.Provider);
    }

    /// <summary>Ingests a webhook for <paramref name="provider"/> (e.g. <c>paystack</c>).</summary>
    [HttpPost("{provider}")]
    public async Task<IActionResult> Receive(string provider, CancellationToken ct)
    {
        if (!Enum.TryParse<PaymentProvider>(provider, ignoreCase: true, out var parsed)
            || !_validators.TryGetValue(parsed, out var validator))
        {
            return NotFound();
        }

        // Read the body verbatim. Signatures are byte-exact, so we must NOT let model binding
        // re-serialize it — that is why there is no [FromBody] parameter here.
        string rawBody;
        using (var reader = new StreamReader(Request.Body))
            rawBody = await reader.ReadToEndAsync(ct);

        var headers = Request.Headers.ToDictionary(
            h => h.Key, h => h.Value.ToString(), StringComparer.OrdinalIgnoreCase);

        // Validate signature FIRST. An unsigned or mis-signed request never reaches the inbox.
        var validation = validator.Validate(new WebhookRequest(rawBody, headers));
        if (validation.IsFailure)
            return StatusCode(ApiControllerBase.StatusFor(validation.Error.Type), new ApiError(validation.Error.Code, validation.Error.Message));

        var message = validation.Value;

        var ingest = await _sender.Send(
            new IngestWebhookCommand(parsed, message.ProviderEventId, message.EventType, message.PaymentReference, rawBody),
            ct);

        // A persisted event (including a recognised duplicate) is a 200 so the provider stops retrying;
        // the worker takes it from here.
        return ingest.IsSuccess
            ? Ok(new { received = true })
            : StatusCode(ApiControllerBase.StatusFor(ingest.Error.Type), new ApiError(ingest.Error.Code, ingest.Error.Message));
    }
}
