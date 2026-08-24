using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrialDeviceAndJobFingerprint : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeviceFingerprint",
                table: "transcription_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "trial_devices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FirstSeenAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FirstSeenCountry = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    LastSeenCountry = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    FirstSeenIp = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_trial_devices", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_transcription_jobs_DeviceFingerprint_TrialConsumedAtUtc",
                table: "transcription_jobs",
                columns: new[] { "DeviceFingerprint", "TrialConsumedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_trial_devices_Fingerprint",
                table: "trial_devices",
                column: "Fingerprint",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "trial_devices");

            migrationBuilder.DropIndex(
                name: "IX_transcription_jobs_DeviceFingerprint_TrialConsumedAtUtc",
                table: "transcription_jobs");

            migrationBuilder.DropColumn(
                name: "DeviceFingerprint",
                table: "transcription_jobs");
        }
    }
}
