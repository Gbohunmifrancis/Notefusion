using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWebEventVisitDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Browser",
                table: "web_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Country",
                table: "web_events",
                type: "character varying(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Os",
                table: "web_events",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Ref",
                table: "web_events",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmCampaign",
                table: "web_events",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmContent",
                table: "web_events",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmMedium",
                table: "web_events",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmSource",
                table: "web_events",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UtmTerm",
                table: "web_events",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Browser",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "Country",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "Os",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "Ref",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "UtmCampaign",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "UtmContent",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "UtmMedium",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "UtmSource",
                table: "web_events");

            migrationBuilder.DropColumn(
                name: "UtmTerm",
                table: "web_events");
        }
    }
}
