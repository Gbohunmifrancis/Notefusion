using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLinkTranscriptionJobs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "transcription_jobs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "SongCreditConsumedAtUtc",
                table: "transcription_jobs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "WasPro",
                table: "transcription_jobs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_UserId_Kind_SongCreditConsumedAtUtc",
                table: "transcription_jobs",
                columns: new[] { "UserId", "Kind", "SongCreditConsumedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_transcription_jobs_UserId_Kind_SongCreditConsumedAtUtc",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "SongCreditConsumedAtUtc",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "WasPro",
                table: "transcription_jobs");
        }
    }
}
