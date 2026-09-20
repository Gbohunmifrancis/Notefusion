using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations;

/// <inheritdoc />
public partial class AddWebPreviewAndProductEvents : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "web_preview_jobs",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                JobId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                PreviewTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                DeviceFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                SettledAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                ResultJson = table.Column<string>(type: "text", nullable: true),
                Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_web_preview_jobs", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "product_events",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                Name = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                OccurredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                Surface = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                AnonymousId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                JobId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                MetadataJson = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_product_events", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_web_preview_jobs_JobId",
            table: "web_preview_jobs",
            column: "JobId",
            unique: true);
        migrationBuilder.CreateIndex(
            name: "IX_web_preview_jobs_PreviewTokenHash",
            table: "web_preview_jobs",
            column: "PreviewTokenHash",
            unique: true);
        migrationBuilder.CreateIndex(
            name: "IX_web_preview_jobs_DeviceFingerprint_CreatedAtUtc",
            table: "web_preview_jobs",
            columns: new[] { "DeviceFingerprint", "CreatedAtUtc" });
        migrationBuilder.CreateIndex(
            name: "IX_web_preview_jobs_ExpiresAtUtc",
            table: "web_preview_jobs",
            column: "ExpiresAtUtc");
        migrationBuilder.CreateIndex(
            name: "IX_product_events_Name_OccurredAtUtc",
            table: "product_events",
            columns: new[] { "Name", "OccurredAtUtc" });
        migrationBuilder.CreateIndex(
            name: "IX_product_events_JobId",
            table: "product_events",
            column: "JobId");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "product_events");
        migrationBuilder.DropTable(name: "web_preview_jobs");
    }
}
