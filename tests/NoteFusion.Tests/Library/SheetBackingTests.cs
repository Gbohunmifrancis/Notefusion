using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Api.Common;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Library;

/// <summary>
/// The song's own instrumental under the tune (board o-backing). The worker hands it back with a separated job; for the
/// owner's own upload it is kept with the sheet the job is filed as, so it still plays next week, and for a pasted link
/// it never is (someone else's recording), playing only while the job is fresh. Only the owner ever gets the bytes, and
/// they go when the sheet or the account goes.
/// </summary>
public class SheetBackingTests
{
    private const string Password = "password123";
    private static readonly byte[] Mp3 = [0xFF, 0xFB, 0x90, 0x64, 0x00, 0x0F, 0xF0, 0x01];

    // ------------------------------------------------------------------ filing

    [Fact]
    public async Task An_uploaded_songs_backing_is_kept_with_the_sheet_it_is_filed_as()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);

        var read = await Poll(h, user, Worker(job, Result()), job);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.SourceJobId == job.JobId);
        Assert.Equal(sheet.Id, read.Value.SavedId);
        Assert.True(sheet.HasBacking);
        Assert.Equal(Mp3, h.Backing.Files[sheet.BackingKey!]);
        Assert.StartsWith($"backing/{user.Id:N}/", sheet.BackingKey);
        Assert.False(sheet.FromLink);
        Assert.Equal(1.25, sheet.BeatOriginSec);
        Assert.Equal([1.25, 1.875, 2.5], sheet.BeatTimesSec!);
        Assert.Equal(0, sheet.TransposedBy);

        var dto = (await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new GetTranscriptionQuery(sheet.Id), default)).Value;
        Assert.True(dto.HasBacking);
        Assert.False(dto.FromLink);
        Assert.Equal(1.25, dto.BeatOriginSec);
        Assert.Equal([1.25, 1.875, 2.5], dto.BeatTimesSec!);
        Assert.Equal(0, dto.TransposedBy);

        // A list row says so too, without the beat list (that is for the open sheet).
        var row = Assert.Single((await new GetLibraryQueryHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new GetLibraryQuery(), default)).Value);
        Assert.True(row.HasBacking);
        Assert.Null(row.BeatTimesSec);
    }

    [Fact]
    public async Task The_completion_step_keeps_it_too_for_a_free_accounts_song_upload()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Upload);

        var done = await new NotifyTranscriptionReadyCommandHandler(
                h.Db, Worker(job, Result()), h.Clock, h.Push, Substitute.For<ITranscriptionNotifier>(), h.WebPush, h.QuotaGate, h.Backing)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), default);

        Assert.True(done.IsSuccess);
        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.True(sheet.HasBacking);
        Assert.Equal(Mp3, h.Backing.Files[sheet.BackingKey!]);
    }

    [Fact]
    public async Task A_pasted_links_sheet_never_keeps_the_backing_which_plays_only_while_the_job_is_fresh()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Link);
        var api = Worker(job, Result(link: true));

        var fresh = await Poll(h, user, api, job, includeBacking: false);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.True(sheet.FromLink);
        Assert.False(sheet.HasBacking);
        Assert.Empty(h.Backing.Files);
        Assert.True((await GetSheet(h, user, sheet.Id)).FromLink);

        // While the worker holds the job, the backing is there to play, from its copy.
        Assert.True(fresh.Value.Result!.HasBacking);
        Assert.Equal(Mp3, (await JobBacking(h, user, api, job)).Value);

        // Once it has forgotten the job, there is none: the result says so, and the backing route finds nothing.
        h.Clock.UtcNow = h.Clock.UtcNow.AddMinutes(20);
        api.ClearReceivedCalls();
        var later = await Poll(h, user, api, job, includeBacking: false);
        Assert.False(later.Value.Result!.HasBacking);
        var gone = await JobBacking(h, user, api, job);
        Assert.Equal("BACKING_NOT_FOUND", gone.Error.Code);
        Assert.Equal(ErrorType.NotFound, gone.Error.Type);
        await api.DidNotReceiveWithAnyArgs().GetJobAsync(default!, default);
    }

    [Fact]
    public async Task Even_a_link_job_of_upload_kind_that_names_its_song_keeps_no_backing()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Upload);

        await Poll(h, user, Worker(job, Result(link: true)), job);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.True(sheet.FromLink);
        Assert.False(sheet.HasBacking);
        Assert.Empty(h.Backing.Files);
    }

    [Fact]
    public async Task A_store_that_is_off_files_the_sheet_without_its_backing()
    {
        using var h = new TestHarness();
        h.Backing.Refuse = true;
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);

        var read = await Poll(h, user, Worker(job, Result()), job);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.Equal(sheet.Id, read.Value.SavedId);
        Assert.False(sheet.HasBacking);
        Assert.Equal(1.25, sheet.BeatOriginSec);
    }

    [Fact]
    public async Task A_backing_without_tracked_beats_keeps_a_beat_clock_written_out_at_the_tempo_it_was_heard_at()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);

        await Poll(h, user, Worker(job, Result() with { BeatTimesSec = null }), job);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        // 96 BPM from 1.25 s, a beat every 0.625 s: the notes end on beat 2, and four beats run on past it.
        Assert.Equal([1.25, 1.875, 2.5, 3.125, 3.75, 4.375, 5.0], sheet.BeatTimesSec!);
        Assert.Equal(sheet.BeatTimesSec!, (await GetSheet(h, user, sheet.Id)).BeatTimesSec!);
    }

    [Fact]
    public async Task A_tempo_edit_after_filing_leaves_the_backings_beat_clock_alone()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        await Poll(h, user, Worker(job, Result() with { BeatTimesSec = null }), job);
        var id = (await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id)).Id;
        var before = (await GetSheet(h, user, id)).BeatTimesSec!.ToList();

        var edited = await new UpdateTranscriptionTempoCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new UpdateTranscriptionTempoCommand(id, 120), default);

        Assert.Equal(120, edited.Value.TempoBpm);
        Assert.Equal(before, edited.Value.BeatTimesSec!);
        Assert.Equal(1.25, edited.Value.BeatOriginSec);
    }

    [Fact]
    public async Task Only_a_sheet_with_a_backing_has_its_beat_clock_written_out()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Link);

        await Poll(h, user, Worker(job, Result(link: true) with { BeatTimesSec = null }), job);

        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.Null(sheet.BeatTimesSec);
        Assert.Equal(1.25, sheet.BeatOriginSec);
    }

    // ------------------------------------------------------------------ the job's answer

    [Fact]
    public async Task Asking_without_the_backing_leaves_the_bytes_out_but_says_there_is_one()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        var api = Worker(job, Result());

        var lean = await Poll(h, user, api, job, includeBacking: false);
        var old = await Poll(h, user, api, job);

        Assert.True(lean.Value.Result!.HasBacking);
        Assert.Equal("", lean.Value.Result.BackingAudioBase64);
        Assert.Equal([1.25, 1.875, 2.5], lean.Value.Result.BeatTimesSec!);
        // A caller that does not ask (a shipped app) is handed the bytes, as before.
        Assert.Equal(Convert.ToBase64String(Mp3), old.Value.Result!.BackingAudioBase64);
        Assert.True(old.Value.Result.HasBacking);
    }

    [Fact]
    public async Task A_result_without_a_backing_says_so()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Upload);

        var read = await Poll(h, user, Worker(job, Result(backing: false)), job, includeBacking: false);

        Assert.False(read.Value.Result!.HasBacking);
        Assert.False((await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id)).HasBacking);
    }

    [Fact]
    public async Task An_uploads_backing_outlives_the_workers_copy()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        var api = Worker(job, Result());
        await Poll(h, user, api, job, includeBacking: false);

        h.Clock.UtcNow = h.Clock.UtcNow.AddDays(7);
        api.ClearReceivedCalls();
        var later = await Poll(h, user, api, job, includeBacking: false);
        var backing = await JobBacking(h, user, api, job);

        // Answered from the banked copy, which holds no bytes, and the sheet, which keeps them.
        Assert.True(later.Value.Result!.HasBacking);
        Assert.Equal("", later.Value.Result.BackingAudioBase64);
        Assert.Equal(Mp3, backing.Value);
        await api.DidNotReceiveWithAnyArgs().GetJobAsync(default!, default);
    }

    [Fact]
    public void The_banked_copy_of_a_result_holds_no_backing_but_keeps_its_beat_clock()
    {
        var banked = TranscriptionResultCache.Deserialize(TranscriptionResultCache.Serialize(Result()))!;

        Assert.Equal("", banked.BackingAudioBase64);
        Assert.False(banked.HasBacking);
        Assert.Equal(1.25, banked.BeatOriginSec);
        Assert.Equal([1.25, 1.875, 2.5], banked.BeatTimesSec!);
    }

    // ------------------------------------------------------------------ who gets it

    [Fact]
    public async Task Only_the_owner_gets_a_backing()
    {
        using var h = new TestHarness();
        var (owner, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        var stranger = await SeedUserAsync(h, "stranger@example.com");
        var api = Worker(job, Result());
        await Poll(h, owner, api, job);
        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == owner.Id);

        Assert.Equal(Mp3, (await SheetBacking(h, owner, sheet.Id)).Value);
        Assert.Equal(Mp3, (await JobBacking(h, owner, api, job)).Value);

        var theirs = await SheetBacking(h, stranger, sheet.Id);
        var theirJob = await JobBacking(h, stranger, api, job);
        var nobody = await new GetSheetBackingQueryHandler(h.Db, new StubCurrentUser(null), h.Backing)
            .Handle(new GetSheetBackingQuery(sheet.Id), default);
        Assert.Equal("BACKING_NOT_FOUND", theirs.Error.Code);
        Assert.Equal(ErrorType.NotFound, theirs.Error.Type);
        Assert.Equal("BACKING_NOT_FOUND", theirJob.Error.Code);
        Assert.Equal("BACKING_NOT_FOUND", nobody.Error.Code);
    }

    [Fact]
    public async Task A_sheet_without_a_backing_and_one_that_does_not_exist_are_not_found()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Upload);
        await Poll(h, user, Worker(job, Result(backing: false)), job);
        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);

        Assert.Equal("BACKING_NOT_FOUND", (await SheetBacking(h, user, sheet.Id)).Error.Code);
        Assert.Equal("BACKING_NOT_FOUND", (await SheetBacking(h, user, Guid.NewGuid())).Error.Code);
        Assert.Equal("BACKING_NOT_FOUND", (await JobBacking(h, user, Worker(job, Result(backing: false)), job)).Error.Code);
    }

    [Fact]
    public async Task The_backing_is_served_as_audio_that_seeks_by_range_and_is_kept_private()
    {
        var sender = Substitute.For<ISender>();
        sender.Send(Arg.Any<GetSheetBackingQuery>(), Arg.Any<CancellationToken>()).Returns(Result<byte[]>.Success(Mp3));
        var controller = new LibraryController(sender) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

        var file = Assert.IsType<FileContentResult>(await controller.GetBacking(Guid.NewGuid(), default));

        Assert.Equal("audio/mpeg", file.ContentType);
        Assert.True(file.EnableRangeProcessing);
        Assert.Equal(Mp3, file.FileContents);
        Assert.Equal("private, max-age=86400", controller.Response.Headers.CacheControl.ToString());

        sender.Send(Arg.Any<GetSheetBackingQuery>(), Arg.Any<CancellationToken>())
            .Returns(NoteFusion.Shared.Results.Result.Failure<byte[]>(NoteFusion.Application.Common.Errors.LibraryErrors.BackingNotFound));
        var missing = Assert.IsType<ObjectResult>(await controller.GetBacking(Guid.NewGuid(), default));
        Assert.Equal(404, missing.StatusCode);
        Assert.Equal("BACKING_NOT_FOUND", Assert.IsType<ApiError>(missing.Value).Code);
    }

    // ------------------------------------------------------------------ transposing

    [Fact]
    public async Task Transposing_counts_the_semitones_from_the_key_it_was_heard_in_and_going_back_returns_to_zero()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        await Poll(h, user, Worker(job, Result()), job);
        var id = (await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id)).Id;
        var transpose = new TransposeTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id));

        var up = await transpose.Handle(new TransposeTranscriptionCommand(id, 2), default);
        var further = await transpose.Handle(new TransposeTranscriptionCommand(id, 3), default);
        Assert.Equal(2, up.Value.TransposedBy);
        Assert.Equal(5, further.Value.TransposedBy);
        Assert.Equal("C major", further.Value.Key);

        var back = await transpose.Handle(new TransposeTranscriptionCommand(id, -further.Value.TransposedBy), default);

        Assert.Equal(0, back.Value.TransposedBy);
        Assert.Equal("G major", back.Value.Key);
        Assert.True(back.Value.HasBacking); // kept throughout; the clients play it only at 0
    }

    // ------------------------------------------------------------------ the owner's Save

    [Fact]
    public async Task Saving_over_the_filed_copy_keeps_its_backing_and_how_far_it_was_transposed()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        await Poll(h, user, Worker(job, Result()), job);
        var filed = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        await new TransposeTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new TransposeTranscriptionCommand(filed.Id, 2), default);

        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Our song", "A major", 96, "4/4", "<score-partwise version=\"4.0\" />",
                [new NoteEventDto(69, 0, 1, 1, "d", "", 0.95)], 0.9, job.JobId), default);

        Assert.True(saved.IsSuccess);
        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.NotEqual(filed.Id, sheet.Id);
        Assert.Equal(filed.BackingKey, sheet.BackingKey);
        Assert.Equal(Mp3, h.Backing.Files[sheet.BackingKey!]);
        Assert.Empty(h.Backing.Deleted);
        Assert.Equal(2, saved.Value.TransposedBy);
        Assert.True(saved.Value.HasBacking);
        Assert.Equal(1.25, saved.Value.BeatOriginSec);
    }

    [Fact]
    public async Task A_result_transposed_in_the_client_before_saving_says_how_far_and_the_backing_then_sits_out()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        await Poll(h, user, Worker(job, Result()), job);

        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Our song", "C major", 96, "4/4", "<score-partwise version=\"4.0\" />",
                [new NoteEventDto(72, 0, 1, 1, "d", "", 0.95)], 0.9, job.JobId, TransposedBy: 3), default);

        Assert.True(saved.IsSuccess);
        Assert.Equal(3, saved.Value.TransposedBy);
        Assert.True(saved.Value.HasBacking);
        Assert.False(new SaveTranscriptionCommandValidator().Validate(
            new SaveTranscriptionCommand("x", "C major", 96, "4/4", "<score-partwise />", [], 0.9, null,
                TransposedBy: Transcription.MaxTransposedBy + 1)).IsValid);
    }

    [Fact]
    public async Task Saving_a_link_job_whose_filed_copy_was_deleted_still_says_it_came_from_a_link()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Link);
        await Poll(h, user, Worker(job, Result(link: true)), job);
        var filed = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        await new DeleteTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id)).Handle(new DeleteTranscriptionCommand(filed.Id), default);

        var saved = await new SaveTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id), h.QuotaGate).Handle(
            new SaveTranscriptionCommand("Abide with me", "G major", 96, "4/4", "<score-partwise version=\"4.0\" />",
                [new NoteEventDto(67, 0, 1, 1, "d", "", 0.95)], 0.9, job.JobId), default);

        Assert.True(saved.Value.FromLink);
        Assert.False(saved.Value.HasBacking);
        Assert.Equal(1.25, saved.Value.BeatOriginSec);
    }

    // ------------------------------------------------------------------ deleting

    [Fact]
    public async Task Deleting_the_sheet_deletes_its_backing()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        await Poll(h, user, Worker(job, Result()), job);
        var sheet = await h.Db.Transcriptions.AsNoTracking().SingleAsync(t => t.UserId == user.Id);

        var deleted = await new DeleteTranscriptionCommandHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new DeleteTranscriptionCommand(sheet.Id), default);

        Assert.True(deleted.IsSuccess);
        Assert.Equal([sheet.BackingKey!], h.Backing.Deleted);
        Assert.Empty(h.Backing.Files);
        // The job's own route has nothing to hand out any more either (its worker copy is long gone).
        h.Clock.UtcNow = h.Clock.UtcNow.AddHours(1);
        Assert.Equal("BACKING_NOT_FOUND", (await JobBacking(h, user, Worker(job, Result()), job)).Error.Code);
    }

    [Fact]
    public async Task Closing_the_account_deletes_every_backing_it_kept()
    {
        using var h = new TestHarness();
        var (user, job) = await SeedAsync(h, TranscriptionJobKind.Song);
        var other = await SeedUserAsync(h, "other@example.com");
        await Poll(h, user, Worker(job, Result()), job);
        // A file no sheet names any more (its own delete failed once) goes with the account too.
        await h.Backing.SaveAsync(user.Id, Mp3, default);
        var theirs = (await h.Backing.SaveAsync(other.Id, Mp3, default)).Value;

        var closed = await new DeleteMyAccountCommandHandler(h.Db, h.Hasher, new StubGoogleTokenValidator(), new StubCurrentUser(user.Id))
            .Handle(new DeleteMyAccountCommand(Password, null), default);

        Assert.True(closed.IsSuccess);
        Assert.Equal([user.Id], h.Backing.SweptAccounts);
        Assert.Equal([theirs], h.Backing.Files.Keys);
    }

    // ------------------------------------------------------------------ the sheet's rules

    [Fact]
    public void A_sheet_from_a_link_can_never_hold_a_backing()
    {
        var sheet = new Transcription(Guid.NewGuid(), "Song", new MusicalKey(7, KeyMode.Major), 96, "4/4", "<s/>",
            [new NoteEvent { PitchMidi = 67, StartBeat = 0, DurationBeats = 1, Confidence = 1 }], 0.9, "job-1");
        sheet.MarkFromLink();

        Assert.Throws<InvalidOperationException>(() => sheet.KeepBacking("backing/x.mp3"));
        Assert.False(sheet.HasBacking);
    }

    // ------------------------------------------------------------------ helpers

    private static TranscriptionResultDto Result(bool link = false, bool backing = true) => new(
        "G major", 0.9, 96, "4/4", "<score-partwise version=\"4.0\" />", "",
        [new NoteEventDto(67, 0, 1, 1, "d", "", 0.95), new NoteEventDto(69, 1, 1, 2, "r", "", 0.95)], ["d r"], 0.9, "")
    {
        Separated = true,
        BeatOriginSec = 1.25,
        BeatTimesSec = [1.25, 1.875, 2.5],
        BackingAudioBase64 = backing ? Convert.ToBase64String(Mp3) : "",
        HasBacking = backing,
        Source = link ? new SourceDto("youtube", "https://youtu.be/x", "Abide with me", "Choir", null) : null,
    };

    private static async Task<User> SeedUserAsync(TestHarness h, string email)
    {
        var user = User.Create("Ada Obi", email, h.Hasher.Hash(Password), h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }

    private static async Task<(User User, TranscriptionJob Job)> SeedAsync(TestHarness h, TranscriptionJobKind kind)
    {
        var user = await SeedUserAsync(h, "ada@example.com");
        var job = kind switch
        {
            TranscriptionJobKind.Link => TranscriptionJob.RecordLink("job-1", user.Id, h.Clock.UtcNow, "phone-a", wasPro: true),
            TranscriptionJobKind.Song => TranscriptionJob.RecordSong("job-1", user.Id, h.Clock.UtcNow, "phone-a"),
            _ => TranscriptionJob.Record("job-1", user.Id, h.Clock.UtcNow, "phone-a", paidByCredit: true),
        };
        h.Db.TranscriptionJobs.Add(job);
        await h.Db.SaveChangesAsync();
        return (user, job);
    }

    private static ITranscriptionApi Worker(TranscriptionJob job, TranscriptionResultDto result)
    {
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>())
            .Returns(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, result)));
        return api;
    }

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, ITranscriptionApi api, TranscriptionJob job, bool includeBacking = true)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate, h.Backing)
            .Handle(new GetTranscriptionJobQuery(job.JobId, includeBacking), default);

    private static Task<Result<byte[]>> JobBacking(TestHarness h, User user, ITranscriptionApi api, TranscriptionJob job)
        => new GetJobBackingQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, api, h.Backing)
            .Handle(new GetJobBackingQuery(job.JobId), default);

    private static Task<Result<byte[]>> SheetBacking(TestHarness h, User user, Guid id)
        => new GetSheetBackingQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Backing)
            .Handle(new GetSheetBackingQuery(id), default);

    private static async Task<NoteFusion.Application.Library.Dtos.SavedTranscriptionDto> GetSheet(TestHarness h, User user, Guid id)
        => (await new GetTranscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id))
            .Handle(new GetTranscriptionQuery(id), default)).Value;
}
