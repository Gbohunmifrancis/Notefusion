using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSheetBacking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "backing_key",
                table: "transcriptions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "beat_origin_sec",
                table: "transcriptions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "beat_times_json",
                table: "transcriptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "from_link",
                table: "transcriptions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "transposed_by",
                table: "transcriptions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Sheets already made from a pasted link say so, as new ones do (Kind 1 = TranscriptionJobKind.Link). Every
            // existing sheet keeps no backing and no beat clock: those were never kept before.
            migrationBuilder.Sql("""
                UPDATE transcriptions AS t SET from_link = TRUE
                FROM transcription_jobs AS j
                WHERE j."JobId" = t."SourceJobId" AND j."UserId" = t."UserId" AND j."Kind" = 1;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "backing_key",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "beat_origin_sec",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "beat_times_json",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "from_link",
                table: "transcriptions");

            migrationBuilder.DropColumn(
                name: "transposed_by",
                table: "transcriptions");
        }
    }
}
