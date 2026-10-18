using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NeverLoseATake : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "OpenedAtUtc",
                table: "transcriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SavedAutomatically",
                table: "transcriptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "FailureCode",
                table: "transcription_jobs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "transcription_jobs",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_UserId_IdempotencyKey",
                table: "transcription_jobs",
                columns: new[] { "UserId", "IdempotencyKey" },
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_transcription_jobs_UserId_IdempotencyKey",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "OpenedAtUtc",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "SavedAutomatically",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "FailureCode",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "transcription_jobs");
        }
    }
}
