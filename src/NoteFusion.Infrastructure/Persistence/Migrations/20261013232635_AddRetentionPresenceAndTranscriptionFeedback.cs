using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRetentionPresenceAndTranscriptionFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CheckoutReminderSentAtUtc",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAtUtc",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "JobId",
                table: "user_feedback",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AutoSavedAtUtc",
                table: "transcription_jobs",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CheckoutReminderSentAtUtc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "LastSeenAtUtc",
                table: "users");

            migrationBuilder.DropColumn(
                name: "JobId",
                table: "user_feedback");

            migrationBuilder.DropColumn(
                name: "AutoSavedAtUtc",
                table: "transcription_jobs");
        }
    }
}
