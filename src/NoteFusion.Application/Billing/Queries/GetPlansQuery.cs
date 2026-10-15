using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>
/// Lists the plans this caller may buy, cheapest first. Filtered by region (<see cref="PlanEligibility"/>): a
/// Nigerian account sees the naira plans, an account in a regional market the regional dollar plans, anyone
/// else the standard dollar plans, and an account with no known country the naira and standard dollar plans.
/// The one-song purchase (<see cref="BillingInterval.Single"/>) is listed with them, except to a Pro member. Hiding is only half of it; <see cref="Commands.InitiateCheckoutCommandHandler"/> re-checks the same
/// rule, because this list is advice and the checkout is the decision.
/// </summary>
/// <param name="Choir">
/// The choir plans instead of the individual ones. Listed apart (<c>GET api/billing/plans/choir</c>) because
/// app builds already in people's hands render every non-single plan in this list as a Pro option.
/// </param>
public sealed record GetPlansQuery(bool Choir = false) : IRequest<Result<IReadOnlyList<PlanDto>>>;

public sealed class GetPlansQueryHandler : IRequestHandler<GetPlansQuery, Result<IReadOnlyList<PlanDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public GetPlansQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<IReadOnlyList<PlanDto>>> Handle(GetPlansQuery request, CancellationToken ct)
    {
        // The account's stored country, not the country of whoever is asking right now: the offer must stay
        // put when a user travels. Null for an anonymous caller, which is offered what an account with no
        // resolved country gets: naira and the standard dollar set.
        var country = _currentUser.UserId is { } userId
            ? await _db.Users.Where(u => u.Id == userId).Select(u => u.Country).FirstOrDefaultAsync(ct)
            : null;

        // A member has every transcription already, so the one-song purchase is not offered to them.
        var isPro = _currentUser.UserId is { } member && await ProStatus.IsProAsync(_db, _clock, member, ct);

        var plans = await _db.Plans
            .Where(p => p.IsActive && (p.ChoirSeats != null) == request.Choir)
            .OrderBy(p => p.AmountMinor)
            .Select(p => new PlanDto(p.Id, p.Code, p.Name, p.AmountMinor, p.Currency, p.Interval, p.ChoirSeats))
            .ToListAsync(ct);

        // Filtered here rather than in the query: the rule is a shared predicate the checkout handler also
        // calls, and duplicating it as EF-translatable SQL is how the two ends drift apart. The plans table
        // holds a handful of rows.
        return plans
            .Where(p => PlanEligibility.IsOffered(p.Code, p.Currency, country))
            .Where(p => !(isPro && p.Interval == BillingInterval.Single))
            .ToList();
    }
}
