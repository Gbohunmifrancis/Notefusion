using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NoteFusion.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The blog moves into the database: posts, the topic queue, Gemini drafting batches and site-rebuild requests.
    /// Additive (four new tables). Seeds the two launch posts and the topic queue from the repository once.
    /// </summary>
    public partial class AddBlog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "blog_generation_runs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Trigger = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    TopicText = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Model = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    items_json = table.Column<string>(type: "text", nullable: false),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StartedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FinishedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_blog_generation_runs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "blog_posts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Title = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Dek = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    Description = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    tags_json = table.Column<string>(type: "text", nullable: false),
                    Keyword = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CoverUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CoverAlt = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    CoverWidth = table.Column<int>(type: "integer", nullable: true),
                    CoverHeight = table.Column<int>(type: "integer", nullable: true),
                    faq_json = table.Column<string>(type: "text", nullable: false),
                    SeoTitle = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    SeoDescription = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    Author = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PublishAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PublishedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevisedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    GenerationModel = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    generation_usage_json = table.Column<string>(type: "text", nullable: false),
                    review_notes_json = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_blog_posts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "blog_site_rebuilds",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    RequestedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DispatchedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastAttemptAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    Error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_blog_site_rebuilds", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "blog_topics",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Keyword = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Intent = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Angle = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    links_json = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    PostId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_blog_topics", x => x.Id);
                    table.ForeignKey(
                        name: "FK_blog_topics_blog_posts_PostId",
                        column: x => x.PostId,
                        principalTable: "blog_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_blog_generation_runs_Status_CreatedAtUtc",
                table: "blog_generation_runs",
                columns: new[] { "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_blog_generation_runs_Trigger_CreatedAtUtc",
                table: "blog_generation_runs",
                columns: new[] { "Trigger", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_blog_posts_Slug",
                table: "blog_posts",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_blog_posts_Status_PublishAtUtc",
                table: "blog_posts",
                columns: new[] { "Status", "PublishAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_blog_posts_UpdatedAtUtc",
                table: "blog_posts",
                column: "UpdatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_blog_site_rebuilds_DispatchedAtUtc",
                table: "blog_site_rebuilds",
                column: "DispatchedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_blog_site_rebuilds_RequestedAtUtc",
                table: "blog_site_rebuilds",
                column: "RequestedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_blog_topics_PostId",
                table: "blog_topics",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "IX_blog_topics_Slug",
                table: "blog_topics",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_blog_topics_Status_Position",
                table: "blog_topics",
                columns: new[] { "Status", "Position" });

            // The blog that was files in the repository (content/blog/*.md and topics.yml), inserted once here
            // so the database is its one source from now on. See Persistence/Seed/BlogSeed.cs.
            var seed = Seed.BlogSeed.Load();
            migrationBuilder.InsertData(
                table: "blog_posts",
                columns: Seed.BlogSeed.PostColumns,
                values: Seed.BlogSeed.PostRows(seed));
            migrationBuilder.InsertData(
                table: "blog_topics",
                columns: Seed.BlogSeed.TopicColumns,
                values: Seed.BlogSeed.TopicRows(seed, new DateTime(2026, 10, 16, 0, 0, 0, DateTimeKind.Utc)));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "blog_generation_runs");

            migrationBuilder.DropTable(
                name: "blog_site_rebuilds");

            migrationBuilder.DropTable(
                name: "blog_topics");

            migrationBuilder.DropTable(
                name: "blog_posts");
        }
    }
}
