using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Writes the admin audit trail. Every handler that changes an account's state calls this, so the
/// answer to "who did this" is produced by the same code path that did it.
/// </summary>
/// <remarks>
/// <b>Stages, does not save.</b> The row is added to the same change tracker as the effect it records,
/// so the handler's single <c>SaveChangesAsync</c> commits both or neither. An audited action that
/// succeeded without its trail entry is not a state this design can reach.
/// </remarks>
public interface IAuditLogger
{
    /// <summary>
    /// Stages one trail entry for the caller's action. Returns the staged row so a handler can assert on
    /// it in a test; callers in production ignore it.
    /// </summary>
    /// <param name="action">What was done.</param>
    /// <param name="target">The account acted on, or null when the action is not about one account.</param>
    /// <param name="summary">One human sentence, e.g. "Gifted Pro for 1 year".</param>
    /// <param name="note">The operator's own reason, when they gave one.</param>
    AdminAuditLog Record(AdminAuditAction action, User? target, string summary, string? note = null);
}
