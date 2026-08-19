using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTranscriptionJobAndExpiryNotice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ExpiryNoticeSentForPeriodEndUtc",
                table: "subscriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "transcription_jobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JobId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TrialConsumedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_transcription_jobs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_subscriptions_Status_CurrentPeriodEndUtc",
                table: "subscriptions",
                columns: new[] { "Status", "CurrentPeriodEndUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_JobId",
                table: "transcription_jobs",
                column: "JobId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_UserId_TrialConsumedAtUtc",
                table: "transcription_jobs",
                columns: new[] { "UserId", "TrialConsumedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "transcription_jobs");

            migrationBuilder.DropIndex(
                name: "IX_subscriptions_Status_CurrentPeriodEndUtc",
                table: "subscriptions");

            migrationBuilder.DropColumn(
                name: "ExpiryNoticeSentForPeriodEndUtc",
                table: "subscriptions");
        }
    }
}
