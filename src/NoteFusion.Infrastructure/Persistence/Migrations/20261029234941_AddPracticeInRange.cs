using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPracticeInRange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "LearnPartFromRange",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // On for every account, as the entity starts it: the keys move only once both ends are measured.
            migrationBuilder.AddColumn<bool>(
                name: "PracticeInRange",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LearnPartFromRange",
                table: "users");

            migrationBuilder.DropColumn(
                name: "PracticeInRange",
                table: "users");
        }
    }
}
