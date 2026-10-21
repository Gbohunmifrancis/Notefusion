using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// The console's offer preview, rendered by the same <see cref="BrandedEmailTemplate"/> the sender uses
/// (<see cref="EmailSender.SendOfferAsync"/>), so what the admin reads is what goes out.
/// </summary>
public sealed class OfferEmailRenderer : IOfferEmailRenderer
{
    private readonly BrandedEmailTemplate _template;

    public OfferEmailRenderer(BrandedEmailTemplate template) => _template = template;

    public RenderedOfferEmail Render(EmailRecipient to, OfferEmailContent content) => _template.RenderOffer(to, content);
}
