using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddHymnCredit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "hymn_credit",
                table: "transcriptions",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hymn_slug",
                table: "transcriptions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hymn_title",
                table: "transcriptions",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "hymn_url",
                table: "transcriptions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "hymn_credit",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "hymn_slug",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "hymn_title",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "hymn_url",
                table: "transcriptions");
        }
    }
}
