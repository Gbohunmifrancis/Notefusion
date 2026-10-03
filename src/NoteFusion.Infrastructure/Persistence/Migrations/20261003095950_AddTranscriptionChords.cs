using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTranscriptionChords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "chords_json",
                table: "transcriptions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "chords_json",
                table: "transcriptions");
        }
    }
}
