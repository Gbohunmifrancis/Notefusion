using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebPreviewClaimAndEventUser : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ClaimedAtUtc",
                table: "web_preview_jobs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClaimedByUserId",
                table: "web_preview_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClaimedTranscriptionId",
                table: "web_preview_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UserId",
                table: "product_events",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_web_preview_jobs_ClaimedByUserId_ClaimedAtUtc",
                table: "web_preview_jobs",
                columns: new[] { "ClaimedByUserId", "ClaimedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_product_events_AnonymousId",
                table: "product_events",
                column: "AnonymousId");

            migrationBuilder.CreateIndex(
                name: "IX_product_events_UserId",
                table: "product_events",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_web_preview_jobs_ClaimedByUserId_ClaimedAtUtc",
                table: "web_preview_jobs");

            migrationBuilder.DropIndex(
                name: "IX_product_events_AnonymousId",
                table: "product_events");

            migrationBuilder.DropIndex(
                name: "IX_product_events_UserId",
                table: "product_events");

            migrationBuilder.DropColumn(
                name: "ClaimedAtUtc",
                table: "web_preview_jobs");

            migrationBuilder.DropColumn(
                name: "ClaimedByUserId",
                table: "web_preview_jobs");

            migrationBuilder.DropColumn(
                name: "ClaimedTranscriptionId",
                table: "web_preview_jobs");

            migrationBuilder.DropColumn(
                name: "UserId",
                table: "product_events");
        }
    }
}
