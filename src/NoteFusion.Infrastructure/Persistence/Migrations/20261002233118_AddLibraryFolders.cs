using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "folder",
                table: "transcriptions",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "folder_shares",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Folder = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Views = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_folder_shares", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_transcriptions_UserId_folder",
                table: "transcriptions",
                columns: new[] { "UserId", "folder" });

            migrationBuilder.CreateIndex(
                name: "IX_folder_shares_Token",
                table: "folder_shares",
                column: "Token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_folder_shares_UserId_Folder",
                table: "folder_shares",
                columns: new[] { "UserId", "Folder" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "folder_shares");

            migrationBuilder.DropIndex(
                name: "IX_transcriptions_UserId_folder",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "folder",
                table: "transcriptions");
        }
    }
}
