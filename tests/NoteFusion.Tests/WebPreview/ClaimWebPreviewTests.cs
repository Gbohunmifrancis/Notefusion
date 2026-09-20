using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.WebPreview;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.WebPreview;

/// <summary>
/// The hinge of the web funnel: an anonymous preview becoming a row in somebody's library.
/// </summary>
/// <remarks>
/// Two properties carry most of the weight here. The first is that a claim is a <em>transfer</em> — the
/// notation the visitor kept has to be the one they were shown, because re-running the model would be both
/// expensive and free to disagree with what was on screen. The second is that the preview token is a bearer
/// credential: holding it is the only thing that distinguishes the person whose browser made the preview
/// from anyone who read a job ID out of telemetry, so the tests about refusing it matter more than the
/// happy path does.
/// </remarks>
public class ClaimWebPreviewTests
{
    private static readonly DateTime Now = new(2026, 9, 20, 12, 0, 0, DateTimeKind.Utc);

    private const string JobId = "job-abc-123";
    private const string Token = "preview-token-value";

    [Fact]
    public async Task A_finished_preview_becomes_a_library_row_carrying_the_notation_that_was_shown()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var result = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, Token, "My first take"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("My first take", result.Value.Title);
        Assert.Equal("C major", result.Value.Key);
        Assert.Equal(96, result.Value.TempoBpm);
        Assert.Equal("3/4", result.Value.TimeSignature);
        Assert.Equal(0.87, result.Value.OverallConfidence);

        // The whole point of claiming rather than re-transcribing: the engraving is byte-for-byte the
        // one the worker produced for the preview, not a second opinion from a second run.
        Assert.Equal(SampleMusicXml, result.Value.MusicXml);
        Assert.Equal([60, 62, 64], result.Value.Notes!.Select(n => n.PitchMidi));

        // Solfa is re-derived on read rather than transferred, so a claimed row labels like any other.
        Assert.Equal(["d", "r", "m"], result.Value.Notes!.Select(n => n.Solfa));

        var saved = await h.Db.Transcriptions.SingleAsync();
        Assert.Equal(userId, saved.UserId);
        Assert.Equal(JobId, saved.SourceJobId);
    }

    [Fact]
    public async Task Claiming_marks_the_job_so_the_funnel_can_count_it()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var result = await Handler(h, userId).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);

        var job = await h.Db.WebPreviewJobs.SingleAsync();
        Assert.Equal(userId, job.ClaimedByUserId);
        Assert.Equal(Now, job.ClaimedAtUtc);
        Assert.Equal(result.Value.Id, job.ClaimedTranscriptionId);
    }

    [Fact]
    public async Task An_unnamed_claim_still_gets_a_title()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var result = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, Token, "   "), default);

        // Whitespace is not a title. Transcription guards against a blank one, so a handler that passed
        // this through would throw rather than fail, and the visitor would see a 500 on the sign-up step.
        Assert.True(result.IsSuccess);
        Assert.Equal("Web preview", result.Value.Title);
    }

    [Fact]
    public async Task An_overlong_title_is_trimmed_rather_than_rejected()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var result = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, Token, new string('a', 400)), default);

        // The visitor is one field away from having an account; refusing the whole claim over a long
        // filename would lose the conversion the funnel exists to make.
        Assert.True(result.IsSuccess);
        Assert.Equal(120, result.Value.Title.Length);
    }

    // ── Refusals ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_wrong_token_and_an_unknown_job_are_refused_identically()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var wrongToken = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, "not-the-token", null), default);
        var unknownJob = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand("job-does-not-exist", Token, null), default);

        // Identical on purpose. The job ID travels through telemetry and the landing page URL, so an
        // answer that distinguished the two would confirm which IDs exist to anyone who guessed one.
        Assert.True(wrongToken.IsFailure);
        Assert.Equal("WEB_PREVIEW_NOT_FOUND", wrongToken.Error.Code);
        Assert.Equal(wrongToken.Error.Code, unknownJob.Error.Code);
        Assert.Equal(wrongToken.Error.Message, unknownJob.Error.Message);

        Assert.False(await h.Db.Transcriptions.AnyAsync());
    }

    [Fact]
    public async Task An_expired_preview_cannot_be_claimed()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);
        h.Clock.UtcNow = Now.AddHours(25); // past the 24-hour retention window

        var result = await Handler(h, userId).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);

        Assert.True(result.IsFailure);
        Assert.Equal("WEB_PREVIEW_EXPIRED", result.Error.Code);
        Assert.False(await h.Db.Transcriptions.AnyAsync());
    }

    [Fact]
    public async Task A_preview_that_has_not_finished_has_nothing_to_keep_yet()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        h.Db.WebPreviewJobs.Add(NewJob(Now));   // recorded, never settled
        await h.Db.SaveChangesAsync();

        var result = await Handler(h, userId).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);

        // Distinct from a bad token: this caller holds the right one, and the fix is to wait rather
        // than to start over. The landing page needs to tell those two apart to say anything useful.
        Assert.True(result.IsFailure);
        Assert.Equal("WEB_PREVIEW_NOT_READY", result.Error.Code);
    }

    [Fact]
    public async Task An_unauthenticated_caller_cannot_claim()
    {
        using var h = new TestHarness(Now);
        await SeedUser(h);
        await SeedFinishedJob(h);

        var result = await new ClaimWebPreviewCommandHandler(
            h.Db, new StubCurrentUser(userId: null), h.Clock)
            .Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.False(await h.Db.Transcriptions.AnyAsync());
    }

    [Fact]
    public async Task A_second_account_cannot_take_a_preview_somebody_already_kept()
    {
        using var h = new TestHarness(Now);
        var firstUser = await SeedUser(h);
        var secondUser = await SeedUser(h, "second@example.com");
        await SeedFinishedJob(h);

        await Handler(h, firstUser).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);
        var result = await Handler(h, secondUser).Handle(
            new ClaimWebPreviewCommand(JobId, Token, null), default);

        // Both callers hold a valid token — the second one leaked. Ownership, not the token, decides.
        Assert.True(result.IsFailure);
        Assert.Equal("WEB_PREVIEW_ALREADY_CLAIMED", result.Error.Code);
        Assert.Equal(firstUser, (await h.Db.Transcriptions.SingleAsync()).UserId);
    }

    // ── Repeat claims ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Claiming_twice_returns_the_first_row_rather_than_making_a_second()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var first = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, Token, "Original"), default);
        var again = await Handler(h, userId).Handle(
            new ClaimWebPreviewCommand(JobId, Token, "Retried"), default);

        Assert.True(again.IsSuccess);
        Assert.Equal(first.Value.Id, again.Value.Id);

        // A flaky network on the sign-up screen retries the claim; two copies in the library would be
        // the visitor's first impression of the product.
        Assert.Equal(1, await h.Db.Transcriptions.CountAsync());
        Assert.Equal("Original", again.Value.Title);
        Assert.Equal(SampleMusicXml, again.Value.MusicXml);
    }

    [Fact]
    public async Task A_claim_already_made_survives_the_retention_window()
    {
        using var h = new TestHarness(Now);
        var userId = await SeedUser(h);
        await SeedFinishedJob(h);

        var first = await Handler(h, userId).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);
        h.Clock.UtcNow = Now.AddDays(3);
        var again = await Handler(h, userId).Handle(new ClaimWebPreviewCommand(JobId, Token, null), default);

        // Retention governs the anonymous preview, not what somebody kept from it. Expiring the owner's
        // own answer would make the endpoint lie about a transcription that is plainly still in their library.
        Assert.True(again.IsSuccess);
        Assert.Equal(first.Value.Id, again.Value.Id);
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────

    private const string SampleMusicXml = "<score-partwise/>";

    private static ClaimWebPreviewCommandHandler Handler(TestHarness h, Guid userId)
        => new(h.Db, new StubCurrentUser(userId), h.Clock);

    private static async Task<Guid> SeedUser(TestHarness h, string email = "visitor@example.com")
    {
        var user = User.Create("Visitor", email, h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user.Id;
    }

    private static WebPreviewJob NewJob(DateTime createdAt)
        => WebPreviewJob.Record(JobId, HashOf(Token), "device-1", createdAt, createdAt.AddHours(24));

    /// <summary>
    /// A job in the state the polling query leaves it in once the worker finishes: settled, with the full
    /// result — MusicXML included — already cached on the row. That cache is what makes a claim a row
    /// insert instead of a second trip through the model.
    /// </summary>
    private static async Task SeedFinishedJob(TestHarness h)
    {
        var result = new TranscriptionResultDto(
            Key: "C major",
            KeyConfidence: 0.9,
            Tempo: 96,
            TimeSignature: "3/4",
            MusicXml: SampleMusicXml,
            MidiBase64: "TVRoZA==",
            Notes:
            [
                new(60, 0.0, 1.0, 1, "d", "", 0.90),
                new(62, 1.0, 1.0, 2, "r", "", 0.85),
                new(64, 2.0, 1.0, 3, "m", "", 0.86)
            ],
            SolfaLines: ["d r m"],
            OverallConfidence: 0.87);

        var job = NewJob(h.Clock.UtcNow);
        job.Settle(h.Clock.UtcNow, TranscriptionResultCache.Serialize(result), null);
        h.Db.WebPreviewJobs.Add(job);
        await h.Db.SaveChangesAsync();
    }

    /// <summary>
    /// Mirrors the hash the production token helper writes. Computed here rather than called, because the
    /// helper is internal to the Application layer and widening it for a test would be the wrong trade —
    /// and because the point under test is that a token hashing to the stored value is accepted.
    /// </summary>
    private static string HashOf(string token)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
