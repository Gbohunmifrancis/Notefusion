using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebFunnel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "signup_source",
                table: "users",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "share_views",
                table: "transcriptions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "preview_jobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JobId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    DeviceFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Ip = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Succeeded = table.Column<bool>(type: "boolean", nullable: false),
                    SourceTitle = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ClaimedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_preview_jobs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_preview_jobs_ClaimedByUserId",
                table: "preview_jobs",
                column: "ClaimedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_preview_jobs_DeviceFingerprint_CreatedAtUtc",
                table: "preview_jobs",
                columns: new[] { "DeviceFingerprint", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_preview_jobs_Ip_CreatedAtUtc",
                table: "preview_jobs",
                columns: new[] { "Ip", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_preview_jobs_JobId",
                table: "preview_jobs",
                column: "JobId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "preview_jobs");

            migrationBuilder.DropColumn(
                name: "signup_source",
                table: "users");

            migrationBuilder.DropColumn(
                name: "share_views",
                table: "transcriptions");
        }
    }
}
