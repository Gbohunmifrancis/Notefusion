namespace NoteFusion.Application.Blog.Drafting;

/// <summary>A topic to draft, from the queue or in the founder's own words.</summary>
public sealed record DraftTopic(Guid? TopicId, string Slug, string Keyword, string Intent, string Angle, IReadOnlyList<string> Links);

/// <summary>
/// What the drafter tells the model, ported from <c>tools/blog/lib/prompt.mjs</c> word for word. The system
/// instruction is fixed (voice, audience, the rules that cannot bend); the user turn carries this run's
/// topic, the site's pages to link to, and the solfa catalogue — examples NoteFusion's engine has already
/// written (read from the live site), which the model may only cite.
/// </summary>
public static class BlogPrompt
{
    public const string System = """
You write articles for the blog of NoteFusion (notefusion.studio), an app that turns a recording, a hummed tune or a song link into Tonic Solfa and staff notation.

WHO IS WRITING: Francis, the founder of NoteFusion and a church musician. Write in his voice: first person where it is natural ("I", "my advice"), warm, practical and direct. Plain English with British spelling (practise as a verb, colour, programme).

WHO IS READING: choir directors, choristers, music teachers, organists and worship leaders, mostly in Nigeria and across West Africa, who read Tonic Solfa: movable doh, minor keys read la-based (a song in A minor has doh on C and lah as home), octave marks written as a comma below (s,) and an apostrophe above (d'). Many are volunteers who learn new songs from recordings and WhatsApp. Make the advice usable in their rehearsals on Sunday.

RULES THAT CANNOT BEND:
1. Never invent facts. No statistics, percentages, numbers of people, studies, surveys, research findings, quotes, testimonials, named people's opinions, or stories presented as things that really happened ("last week a choir told me…"). If you are not sure something is true, leave it out. General musical knowledge (how keys, intervals, rhythm and voices work) is fine.
2. Never write solfa sequences yourself. Every solfa example must be a fenced block from the catalogue you are given, copied exactly, for example:
```solfa
hymn: amazing-grace
bars: 1-5
```
You may name a single syllable in prose (doh, soh, s,) and the bare scale "d r m f s l t", nothing longer. NoteFusion's engine renders the blocks; the catalogue shows you what each one will look like so you can talk about it accurately.
3. Link only to the pages listed in the request, with Markdown links using the exact paths given (for example [how to read Tonic Solfa](/blog/how-to-read-tonic-solfa)). Include every required link. No external links.
4. Mention NoteFusion only where it genuinely helps the reader, at most two or three times, ending with one short paragraph that links to /app. Describe only what NoteFusion does as listed below. Never mention prices, plans or limits.
5. No filler or stock phrases ("in today's fast-paced world", "delve", "unlock", "game-changer", "in conclusion", "as an AI"). Never mention that you are an AI.

WHAT NOTEFUSION DOES (the only product facts you may use): you hum or sing a tune, upload a recording, or paste a YouTube, Spotify or Apple Music link; it writes the melody in movable-doh Tonic Solfa (la-based for minor keys) with staff notation; when a melody could sit in two keys it asks "Which doh is it?"; it plays the tune back on a piano, slower or looped; "Transpose for my choir" moves the doh and shows whether each part sits comfortably; sheets can be saved and shared with a link. It works in the browser at /app and as an Android app.

FORMAT:
- body: Markdown. No title and no # heading (the page adds the title). Open with two or three short paragraphs that state the problem and what the reader will get. Then 5 to 8 sections with ## headings (### for sub-sections), using numbered steps, lists or a table where they make things clearer. 1,400 to 1,900 words, not counting solfa blocks; never fewer than 1,200. Do not add an FAQ section to the body.
- faq: 4 to 6 questions people actually search for on this topic, each answered in one to three plain sentences.
- title: at most 60 characters, containing the target keyword naturally. description: 120 to 155 characters.
- tags: 2 to 4, lowercase words joined by hyphens; prefer existing tags.
""";

    /// <summary>The structured output the model must return (generateContent's <c>responseSchema</c>), as in gemini.mjs.</summary>
    public const string DraftSchemaJson = """
{
  "type": "OBJECT",
  "properties": {
    "title": { "type": "STRING", "description": "The post title, at most 60 characters, with the target keyword in it naturally." },
    "description": { "type": "STRING", "description": "Meta description, 120-155 characters, a plain sentence that makes a reader want to click." },
    "slug": { "type": "STRING", "description": "lowercase-words-joined-by-hyphens" },
    "tags": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "1-4 lowercase-hyphenated tags" },
    "faq": {
      "type": "ARRAY",
      "description": "4-6 questions a reader would search for, with short direct answers",
      "items": { "type": "OBJECT", "properties": { "question": { "type": "STRING" }, "answer": { "type": "STRING" } }, "required": ["question", "answer"], "propertyOrdering": ["question", "answer"] }
    },
    "body": { "type": "STRING", "description": "The article in Markdown, without the title and without the FAQ" }
  },
  "required": ["title", "description", "slug", "tags", "faq", "body"],
  "propertyOrdering": ["title", "description", "slug", "tags", "faq", "body"]
}
""";

    /// <summary>
    /// The hymns whose bars the prompt spells out (prompt.mjs <c>catalogueHymns</c>): the ones encoded by hand,
    /// plus any imported one the topic must link to. The imported library (hundreds of hymns) stays linkable —
    /// every hymn page is in the page list — but spelling out every first line would double each call's prompt.
    /// </summary>
    public static IReadOnlyList<CatalogueHymn> CatalogueHymns(BlogCatalogue catalogue, IReadOnlyList<string> requiredLinks)
    {
        var linked = requiredLinks
            .Select(l => l.Split('?', '#')[0].TrimEnd('/'))
            .Where(l => l.StartsWith("/hymns/", StringComparison.Ordinal))
            .Select(l => l["/hymns/".Length..])
            .ToHashSet(StringComparer.Ordinal);
        return catalogue.Hymns.Where(h => !h.Imported || linked.Contains(h.Slug)).ToList();
    }

    /// <summary>The solfa catalogue: for each hymn spelled out, the engine's first line, and the scales that can be shown.</summary>
    public static string Catalogue(BlogCatalogue catalogue, IReadOnlyList<string>? requiredLinks = null)
    {
        var lines = CatalogueHymns(catalogue, requiredLinks ?? []).Select(h =>
            $"- hymn: {h.Slug} — \"{h.Title}\" — {h.Key}, {h.Header}, {h.Time}, {h.Bars} bars. First {h.FirstLine.Bars} bars (bars: 1-{h.FirstLine.Bars}) render as:\n    {h.FirstLine.Solfa}\n    words: {h.FirstLine.Words}");
        return $"""
Hymn excerpts (choose bars within the hymn's bar count; add "key: F major" to show the same bars in another key, or "words: false" to hide the words):
{string.Join("\n", lines)}

Scales (any major or minor key):
- scale: G major            → the major scale with letter names under the solfa
- scale: A minor            → the la-based minor scale (doh is C)
- scale: A minor + harmonic: true → the same with the raised seventh, se
""";
    }

    public static string User(DraftTopic topic, IReadOnlyList<LivePost> posts, BlogCatalogue catalogue, IReadOnlyList<string> tags)
    {
        var pages = new List<(string Url, string Title)>
        {
            ("/app", "NoteFusion web app (transcribe a song)"),
            ("/hymns", "Hymns in Tonic Solfa (index)"),
        };
        pages.AddRange(catalogue.Hymns.Select(h => ($"/hymns/{h.Slug}", $"{h.Title} in Tonic Solfa")));
        pages.Add(("/blog", "Blog index"));
        pages.AddRange(posts.Select(p => ($"/blog/{p.Slug}", $"{p.Title} — {p.Description}")));
        var required = topic.Links.Count > 0 ? string.Join(", ", topic.Links) : "(none beyond /app)";

        return $"""
Write a blog post for this topic.

Target keyword: {topic.Keyword}
Search intent: {topic.Intent}
Angle: {topic.Angle}
Slug: {topic.Slug}
Required internal links (use each at least once, where it helps): {required}

Pages you may link to:
{string.Join("\n", pages.Select(p => $"- {p.Url} — {p.Title}"))}

Existing tags: {(tags.Count > 0 ? string.Join(", ", tags) : "(none yet)")}

Solfa catalogue — the only solfa you may show, as ```solfa blocks:
{Catalogue(catalogue, topic.Links)}
Use one to three solfa blocks where they make the explanation concrete. Return the JSON object described by the schema.
""";
    }

    public static string Revision(IEnumerable<string> problems)
        => "The draft does not pass the site's checks yet. Fix every one of these and return the whole post again as the same JSON object:\n"
           + string.Join("\n", problems.Select(p => $"- {p}"));
}
