using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTranscriptionJobResultCache : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ResultJson",
                table: "transcription_jobs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SettledAtUtc",
                table: "transcription_jobs",
                type: "timestamp with time zone",
                nullable: true);

            // Close every pre-existing job. A null SettledAtUtc means "still open" to the completion
            // sweep, so without this the first tick after deploy would pick up every transcription ever
            // run, find the ML service has never heard of them, and tell each owner their recording
            // failed. Stamped with CreatedAtUtc rather than now(): these were settled long ago, and only
            // the null-ness is ever read.
            migrationBuilder.Sql(
                """UPDATE transcription_jobs SET "SettledAtUtc" = "CreatedAtUtc";""");

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_CreatedAtUtc",
                table: "transcription_jobs",
                column: "CreatedAtUtc",
                filter: "\"SettledAtUtc\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_transcription_jobs_CreatedAtUtc",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "ResultJson",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "SettledAtUtc",
                table: "transcription_jobs");
        }
    }
}
