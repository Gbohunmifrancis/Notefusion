using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddActivityLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Detail",
                table: "web_events",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeviceHash",
                table: "web_events",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "transcription_logs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JobId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DeviceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Origin = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Client = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Mode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    ContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: true),
                    LinkUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    KeyRequested = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    TempoRequested = table.Column<int>(type: "integer", nullable: true),
                    TimeSignatureRequested = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    StartSeconds = table.Column<double>(type: "double precision", nullable: true),
                    EndSeconds = table.Column<double>(type: "double precision", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    FailureReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    FinishedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AudioSeconds = table.Column<double>(type: "double precision", nullable: true),
                    DetectedKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    DetectedTempo = table.Column<int>(type: "integer", nullable: true),
                    NoteCount = table.Column<int>(type: "integer", nullable: true),
                    Confidence = table.Column<double>(type: "double precision", nullable: true),
                    SongTitle = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SongArtist = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UsedStorePreview = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_transcription_logs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_web_events_DeviceHash_OccurredAtUtc",
                table: "web_events",
                columns: new[] { "DeviceHash", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_web_events_VisitorId_OccurredAtUtc",
                table: "web_events",
                columns: new[] { "VisitorId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_transcriptions_SourceJobId",
                table: "transcriptions",
                column: "SourceJobId");

            migrationBuilder.CreateIndex(
                name: "IX_transcription_logs_CreatedAtUtc",
                table: "transcription_logs",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_transcription_logs_DeviceHash_CreatedAtUtc",
                table: "transcription_logs",
                columns: new[] { "DeviceHash", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_transcription_logs_JobId",
                table: "transcription_logs",
                column: "JobId");

            migrationBuilder.CreateIndex(
                name: "IX_transcription_logs_UserId_CreatedAtUtc",
                table: "transcription_logs",
                columns: new[] { "UserId", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "transcription_logs");

            migrationBuilder.DropIndex(
                name: "IX_web_events_DeviceHash_OccurredAtUtc",
                table: "web_events");

            migrationBuilder.DropIndex(
                name: "IX_web_events_VisitorId_OccurredAtUtc",
                table: "web_events");

            migrationBuilder.DropIndex(
                name: "IX_transcriptions_SourceJobId",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "Detail",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "DeviceHash",
                table: "web_events");
        }
    }
}
