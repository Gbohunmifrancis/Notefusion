using System.Net;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Outreach.Commands;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The unsubscribe link in outreach emails. Anonymous by design: whoever reads the email clicks it without
/// signing in, and the signed token is the credential. GET is the link in the footer and answers with a
/// small page; POST is the mail client's own one-click unsubscribe (RFC 8058, the List-Unsubscribe-Post
/// header) and answers with an empty 200.
/// </summary>
[AllowAnonymous]
[Route("api/email")]
public sealed class EmailController : ApiControllerBase
{
    private readonly ISender _sender;

    public EmailController(ISender sender) => _sender = sender;

    [HttpGet("unsubscribe")]
    [Produces("text/html")]
    public async Task<IActionResult> Unsubscribe([FromQuery] string? token, CancellationToken ct)
    {
        var result = await _sender.Send(new UnsubscribeEmailCommand(token), ct);
        return result.IsSuccess
            ? Page(StatusCodes.Status200OK, "You're unsubscribed",
                "You won't get emails like that from NoteFusion again. Receipts, password resets and other emails about your account still arrive.")
            : Page(StatusCodes.Status400BadRequest, "That link didn't work", result.Error.Message);
    }

    [HttpPost("unsubscribe")]
    public async Task<IActionResult> OneClickUnsubscribe([FromQuery] string? token, CancellationToken ct)
    {
        var result = await _sender.Send(new UnsubscribeEmailCommand(token), ct);
        return result.IsSuccess ? Ok() : BadRequest();
    }

    private ContentResult Page(int status, string heading, string message) => new()
    {
        StatusCode = status,
        ContentType = "text/html; charset=utf-8",
        Content = $$"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width,initial-scale=1" />
              <meta name="robots" content="noindex" />
              <title>{{WebUtility.HtmlEncode(heading)}} · NoteFusion</title>
              <style>
                body { margin: 0; background: #f4f7fc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
                main { max-width: 480px; margin: 12vh auto 0; padding: 32px 24px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; }
                h1 { font-size: 22px; margin: 0 0 12px; }
                p { color: #5d6d82; line-height: 1.6; margin: 0 0 16px; }
                a { color: #2563eb; }
                @media (prefers-color-scheme: dark) {
                  body { background: #09090b; color: #f1f5f9; }
                  main { background: #18181b; border-color: #27272a; }
                  p { color: #a1a1aa; }
                  a { color: #60a5fa; }
                }
              </style>
            </head>
            <body>
              <main>
                <h1>{{WebUtility.HtmlEncode(heading)}}</h1>
                <p>{{WebUtility.HtmlEncode(message)}}</p>
                <p><a href="https://notefusion.studio">notefusion.studio</a></p>
              </main>
            </body>
            </html>
            """,
    };
}
