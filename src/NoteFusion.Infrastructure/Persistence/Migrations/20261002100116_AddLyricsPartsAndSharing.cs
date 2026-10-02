using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLyricsPartsAndSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "lyrics",
                table: "transcriptions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "parts_json",
                table: "transcriptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "parts_music_xml",
                table: "transcriptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "share_token",
                table: "transcriptions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "shared_at_utc",
                table: "transcriptions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_transcriptions_share_token",
                table: "transcriptions",
                column: "share_token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_transcriptions_share_token",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "lyrics",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "parts_json",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "parts_music_xml",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "share_token",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "shared_at_utc",
                table: "transcriptions");
        }
    }
}
