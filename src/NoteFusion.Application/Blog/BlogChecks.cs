using System.Text.RegularExpressions;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Blog;

/// <summary>The fields of a post the checks read.</summary>
public sealed record BlogCheckInput(
    string Slug,
    string Title,
    string Description,
    string? Dek,
    IReadOnlyList<string> Tags,
    IReadOnlyList<BlogFaqItem> Faq,
    string Body,
    string Author,
    string? CoverUrl,
    string? CoverAlt,
    int? CoverWidth,
    int? CoverHeight)
{
    public static BlogCheckInput From(BlogPost p) => From(p.Slug, p.Content());

    public static BlogCheckInput From(string slug, BlogPostContent c) => new(
        slug, c.Title, c.Description, c.Dek, c.Tags, c.Faq, c.Body, c.Author, c.CoverUrl, c.CoverAlt, c.CoverWidth, c.CoverHeight);
}

/// <summary>A live post, as the checks and the drafter's prompt need it.</summary>
public sealed record LivePost(string Slug, string Title, string Description, IReadOnlyList<string> Tags);

/// <summary>
/// What a post is checked against: the site's catalogue (null when it could not be read: the checks that need
/// it are then skipped), the other live posts, and the links a drafted topic must contain.
/// </summary>
public sealed record BlogCheckContext(BlogCatalogue? Catalogue, IReadOnlyList<LivePost> OtherLivePosts, IReadOnlyList<string> RequiredLinks)
{
    /// <summary>Whether an internal path is a page on the site: in the catalogue, or a live post.</summary>
    public bool LinkExists(string href)
    {
        var path = href.Split('#')[0].Split('?')[0];
        path = path.Length > 1 ? path.TrimEnd('/') : path;
        if (path.Length == 0)
            path = "/";
        return Catalogue is null
               || Catalogue.HasPage(path)
               || OtherLivePosts.Any(p => path == "/blog/" + p.Slug);
    }
}

/// <summary>Blockers stop a post going live; advice is shown to the editor and sent back to the model.</summary>
public sealed record BlogCheckResult(IReadOnlyList<string> Blockers, IReadOnlyList<string> Advice)
{
    public IReadOnlyList<string> All => [.. Blockers, .. Advice.Where(a => !Blockers.Contains(a))];
}

/// <summary>
/// The automatic checks on a post. Two kinds:
/// <list type="bullet">
///   <item><b>Blockers</b>: what would stop the site's build, or break the page — the build's own validation
///   (<c>tools/blog/lib/content.mjs</c> <c>validatePost</c>, <c>markdown.mjs</c>) plus broken internal links and
///   raw script HTML. A post with any of these cannot be published.</item>
///   <item><b>Advice</b>: the drafter's quality checks, ported from <c>tools/blog/lib/quality.mjs</c> sentence for
///   sentence — length, sections, FAQ, stock AI phrases, placeholders, invented numbers, studies, quotes and
///   testimonials, solfa written by hand, links. A generated draft must pass them all (one revision round);
///   a post written by hand is warned, not stopped.</item>
/// </list>
/// Each problem is a sentence the drafter can send back to the model as it is.
/// </summary>
public static partial class BlogChecks
{
    public const int TitleMin = 20, TitleMax = 60, DescMin = 110, DescMax = 155, WordsMin = 800, WordsMax = 2200,
        H2Min = 4, FaqMin = 3, FaqMax = 8, DraftTagsMax = 4;

    public static BlogCheckResult Check(BlogCheckInput post, BlogCheckContext ctx)
    {
        var blockers = new List<string>();
        var advice = new List<string>();
        var title = post.Title.Trim();
        var desc = post.Description.Trim();
        var body = post.Body ?? string.Empty;
        var prose = StripFences(body);

        // ── Blockers: the build's validation ────────────────────────────────────────────────────
        if (!BlogPost.IsSlug(post.Slug))
            blockers.Add($"The slug \"{post.Slug}\" must be lowercase words joined by hyphens.");
        if (title.Length == 0)
            blockers.Add("Give the post a title.");
        if (desc.Length == 0)
            blockers.Add("Give the post a description (it is the summary in search results and lists).");
        else if (desc.Length > BlogPost.DescriptionMaxLength)
            blockers.Add($"The description is {desc.Length} characters; keep it to {BlogPost.DescriptionMaxLength}.");
        if (post.Dek is { } dek && dek.Trim().Length > BlogPost.DekMaxLength)
            blockers.Add($"The line under the title is {dek.Trim().Length} characters; keep it to {BlogPost.DekMaxLength}.");
        if (post.Tags.Count == 0 || post.Tags.Count > BlogPost.MaxTags || post.Tags.Any(t => !BlogPost.IsSlug(t)))
            blockers.Add($"Give 1–{BlogPost.MaxTags} tags, each lowercase-hyphenated (e.g. tonic-solfa).");
        if (ctx.Catalogue is { } cat && !cat.Authors.Contains(post.Author))
            blockers.Add($"The author must be one of: {string.Join(", ", cat.Authors)}.");
        for (var i = 0; i < post.Faq.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(post.Faq[i].Question) || string.IsNullOrWhiteSpace(post.Faq[i].Answer))
                blockers.Add($"FAQ {i + 1} needs a question and an answer.");
        }
        if (post.CoverUrl is { } cover)
        {
            if (!(cover.StartsWith('/') && !cover.StartsWith("//")) && !cover.StartsWith("https://", StringComparison.Ordinal))
                blockers.Add("The cover image must be a site path (/assets/blog/…) or an https:// address.");
            if (string.IsNullOrWhiteSpace(post.CoverAlt) || post.CoverWidth is not > 0 || post.CoverHeight is not > 0)
                blockers.Add("The cover image needs alt text, a width and a height.");
        }
        if (string.IsNullOrWhiteSpace(body))
            blockers.Add("The post has no body yet.");
        if (H1().IsMatch(prose) || SetextH1().IsMatch(prose))
            blockers.Add("The body has a top-level heading (# …). The title is the page's only h1; start sections at ##.");
        foreach (Match img in Image().Matches(prose))
        {
            if (!ImageSize().IsMatch(img.Groups["title"].Value))
                blockers.Add($"image {img.Groups["src"].Value}: give its size as the title, e.g. ![alt]({img.Groups["src"].Value} \"1200x675\")");
        }
        foreach (var block in SolfaBlocks.Find(body))
        {
            if (SolfaBlocks.Problem(block, ctx.Catalogue) is { } problem)
                blockers.Add($"The body does not build: {problem}");
        }
        if (RawHtml().IsMatch(body))
            blockers.Add("The body contains raw HTML (script, iframe, style, form…); use Markdown only.");
        if (title.Length > 0 && ctx.OtherLivePosts.Any(p => string.Equals(p.Title.Trim(), title, StringComparison.OrdinalIgnoreCase)))
            blockers.Add($"A post titled \"{title}\" already exists.");

        var links = Links(body);
        var faqLinks = post.Faq.SelectMany(f => FaqLink().Matches(f.Answer ?? string.Empty).Select(m => m.Groups[1].Value)).ToList();
        var allLinks = links.Concat(faqLinks).ToList();
        foreach (var h in allLinks.Where(h => h.StartsWith('/')).Distinct())
        {
            if (!ctx.LinkExists(h))
                blockers.Add($"The link {h} goes to a page that does not exist.");
        }

        // ── Advice: quality.mjs ────────────────────────────────────────────────────────────────
        if (title.Length < TitleMin || title.Length > TitleMax)
            advice.Add($"The title is {title.Length} characters; it must be {TitleMin}–{TitleMax}.");
        if (desc.Length < DescMin || desc.Length > DescMax)
            advice.Add($"The description is {desc.Length} characters; it must be {DescMin}–{DescMax}.");
        var words = CountWords(prose);
        if (words < WordsMin || words > WordsMax)
            advice.Add($"The body is {words} words; it must be {WordsMin}–{WordsMax} (not counting solfa blocks).");
        var h2 = H2().Matches(prose).Count;
        if (h2 < H2Min)
            advice.Add($"The body has {h2} sections (## headings); it needs at least {H2Min}.");
        if (FaqSection().IsMatch(prose))
            advice.Add("Put the questions and answers in the faq field, not in a body section.");
        if (post.Faq.Count < FaqMin || post.Faq.Count > FaqMax)
            advice.Add($"The FAQ has {post.Faq.Count} questions; it needs {FaqMin}–{FaqMax}.");
        for (var i = 0; i < post.Faq.Count; i++)
        {
            if (!(post.Faq[i].Question ?? string.Empty).Trim().EndsWith('?'))
                advice.Add($"FAQ {i + 1}: the question must end with a question mark.");
            if (CountWords(post.Faq[i].Answer ?? string.Empty) < 12)
                advice.Add($"FAQ {i + 1}: the answer must be at least one full sentence (12+ words).");
        }

        var all = string.Join("\n", new[] { title, desc, body }.Concat(post.Faq.SelectMany(f => new[] { f.Question, f.Answer })));
        foreach (var (re, shown) in Banned)
        {
            if (re.IsMatch(all))
                advice.Add($"Remove the stock phrase matching {shown} — write it plainly.");
        }
        foreach (var (re, shown) in Placeholders)
        {
            if (re.IsMatch(all))
                advice.Add($"There is placeholder text ({shown}); every sentence must be finished.");
        }
        foreach (var (re, what) in Invented)
        {
            var m = re.Match(all);
            if (m.Success)
            {
                var found = m.Value.Trim();
                advice.Add($"Remove {what} (\"{(found.Length > 60 ? found[..60] : found)}\"): no statistics, studies, quotes or testimonials may be invented.");
            }
        }
        // The bare scale is allowed in prose; any other run of six or more syllables is not.
        var run = SolfaRun().Match(BareScale().Replace(StripFences(all), " "));
        if (run.Success)
        {
            var found = run.Value.Trim();
            advice.Add($"Solfa written by hand (\"{(found.Length > 40 ? found[..40] : found)}\"): every solfa example must be a ```solfa block from the catalogue.");
        }

        var internalLinks = allLinks.Where(h => h.StartsWith('/')).Select(h => h.Split('?', '#')[0]).ToList();
        foreach (var req in ctx.RequiredLinks)
        {
            if (!internalLinks.Contains(req))
                advice.Add($"Link to {req} somewhere in the body.");
        }
        if (!internalLinks.Contains("/app"))
            advice.Add("Link to /app (the NoteFusion web app) once, where it helps the reader.");
        foreach (var h in allLinks.Where(h => !h.StartsWith('/') && !h.StartsWith('#')).Distinct())
            advice.Add($"Remove the external link {h}; link only to pages on notefusion.studio.");

        return new BlogCheckResult(blockers.Distinct().ToList(), advice.Distinct().ToList());
    }

    /// <summary>
    /// Everything a generated draft must pass (quality.mjs's <c>checkDraft</c>): the blockers, the advice, and
    /// the drafter's own limits — at most four tags, a slug no other post has.
    /// </summary>
    public static IReadOnlyList<string> CheckDraft(BlogCheckInput draft, BlogCheckContext ctx, ISet<string> takenSlugs)
    {
        var problems = Check(draft, ctx).All.ToList();
        if (takenSlugs.Contains(draft.Slug))
            problems.Insert(0, $"A post with the slug \"{draft.Slug}\" already exists.");
        if (draft.Tags.Count > DraftTagsMax)
            problems.Add($"Give 1–{DraftTagsMax} tags, each lowercase-hyphenated (e.g. tonic-solfa).");
        return problems.Distinct().ToList();
    }

    /// <summary>Words in a piece of text (util.mjs <c>countWords</c>), for length and reading time.</summary>
    public static int CountWords(string text) => Word().Matches(text ?? string.Empty).Count;

    /// <summary>The body without its fenced blocks: the prose a reader reads.</summary>
    public static string StripFences(string md) => Fence().Replace(md ?? string.Empty, "\n");

    /// <summary>
    /// Every link in the Markdown, as the build's renderer would collect it: inline and reference links,
    /// &lt;autolinks&gt; and bare web addresses (GFM turns those into links). Links to the site's own origin are
    /// made relative, as the build does.
    /// </summary>
    public static IReadOnlyList<string> Links(string markdown)
    {
        var text = InlineCode().Replace(StripFences(markdown), " ");
        var links = new List<string>();
        text = InlineLink().Replace(text, m =>
        {
            if (!m.Value.StartsWith('!'))
                links.Add(m.Groups["href"].Value);
            return " ";
        });
        foreach (Match m in RefDefinition().Matches(text))
            links.Add(m.Groups["href"].Value);
        text = RefDefinition().Replace(text, " ");
        foreach (Match m in AutoLink().Matches(text))
            links.Add(m.Groups["href"].Value);
        text = AutoLink().Replace(text, " ");
        foreach (Match m in BareUrl().Matches(text))
            links.Add(m.Value.TrimEnd('.', ',', ';', ':', '!', '?'));
        return links.Select(Relative).ToList();
    }

    private static string Relative(string href)
    {
        const string origin = "https://notefusion.studio";
        if (href.StartsWith(origin, StringComparison.OrdinalIgnoreCase))
        {
            var rest = href[origin.Length..];
            return rest.Length == 0 ? "/" : rest;
        }
        return href;
    }

    private static readonly (Regex, string)[] Banned =
    [
        Js(@"\bas an ai\b", "i"), Js(@"\blanguage model\b", "i"), Js(@"\bi cannot (?:help|assist|provide)\b", "i"),
        Js(@"\bi'?m sorry\b", "i"), Js(@"\bas of my (?:knowledge|last)\b", "i"), Js(@"\bdelve\b", "i"),
        Js(@"\bin today'?s fast[- ]paced\b", "i"), Js(@"\btapestry\b", "i"), Js(@"\bgame[- ]changer\b", "i"),
        Js(@"\bunlock the (?:power|secrets?)\b", "i"), Js(@"\bin conclusion\b", "i"), Js(@"\bembark on a journey\b", "i"),
        Js(@"\bnavigat(?:e|ing) the (?:world|complexities)\b", "i"),
    ];

    private static readonly (Regex, string)[] Placeholders =
    [
        Js(@"\bTODO\b", ""), Js(@"\bTBD\b", ""), Js("lorem ipsum", "i"), Js(@"\[insert\b", "i"), Js(@"\{\{|\}\}", ""),
        Js(@"\bplaceholder\b", "i"), Js(@"\bXXX?\b", ""), Js(@"\?\?\?", ""), Js(@"\[(?:link|url|name|date)\]", "i"),
    ];

    private static readonly (Regex, string)[] Invented =
    [
        (R(@"\b\d+(?:\.\d+)?\s?(?:%|per ?cent\b)", true), "a percentage"),
        (R(@"\b(?:studies|research|surveys?|statistics|data|experts?)\s+(?:show|shows|suggest|suggests|found|finds|reveal|reveals|prove|proves|say|says)\b", true), "an appeal to studies, research or experts"),
        (R(@"\baccording to\b", true), "an attribution (\"according to …\")"),
        (R(@"\b(?:a|one) (?:recent )?(?:study|survey|report)\b", true), "a study or survey"),
        (R("[“\"][^”\"\\n]{20,}[”\"]\\s*,?\\s*(?:says?|said|told|explains?|explained|recalls?|recalled)\\b", true), "a quotation attributed to someone"),
        (R("[“\"][^”\"\\n]{20,}[”\"]\\s*(?:—|–)\\s*[A-Z]", false), "a quotation attributed to someone"),
        (R(@"\btestimonials?\b", true), "a testimonial"),
        (R(@"\b(?:millions|thousands|hundreds) of (?:choirs|singers|churches|users|people)\b", true), "a claimed count of people"),
    ];

    /// <summary>A pattern and how quality.mjs prints it (<c>/pattern/flags</c>), so the model sees the same sentence.</summary>
    private static (Regex, string) Js(string pattern, string flags) => (R(pattern, flags.Contains('i')), $"/{pattern}/{flags}");

    private static Regex R(string pattern, bool ignoreCase)
        => new(pattern, (ignoreCase ? RegexOptions.IgnoreCase : RegexOptions.None) | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    // Six or more solfa syllables in a row, outside a ```solfa block: solfa the model wrote itself.
    private const string Syl = "(?:d|r|m|f|s|l|t|de|re|fe|se|le|ra|ma|sa|la|ta|doh|ray|me|fah|soh|lah|te)[,']*";

    [GeneratedRegex(@"(?:^|[\s(*_`|:])" + Syl + @"(?:[\s:|.\-–]+" + Syl + @"){5,}(?=$|[\s).,;*_`|])", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex SolfaRun();

    [GeneratedRegex(@"\bd r m f s l t(?: d')?|\bdoh,? ray,? me,? fah,? soh,? lah,? te\b", RegexOptions.IgnoreCase)]
    private static partial Regex BareScale();

    [GeneratedRegex("```[\\s\\S]*?```")]
    private static partial Regex Fence();

    [GeneratedRegex("`[^`\n]*`")]
    private static partial Regex InlineCode();

    [GeneratedRegex(@"[A-Za-zÀ-ÿ0-9'’]+")]
    private static partial Regex Word();

    [GeneratedRegex(@"^#\s", RegexOptions.Multiline)]
    private static partial Regex H1();

    [GeneratedRegex(@"^[^\s#>\-*|][^\n]*\n=+[ \t]*$", RegexOptions.Multiline)]
    private static partial Regex SetextH1();

    [GeneratedRegex(@"^##\s+\S", RegexOptions.Multiline)]
    private static partial Regex H2();

    [GeneratedRegex(@"^#{2,3}\s+(?:faqs?|frequently asked)", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex FaqSection();

    [GeneratedRegex(@"<\s*(?:script|iframe|style|object|embed|form)\b", RegexOptions.IgnoreCase)]
    private static partial Regex RawHtml();

    [GeneratedRegex("!\\[(?<alt>[^\\]]*)\\]\\(\\s*(?<src>[^)\\s]+)(?:\\s+\"(?<title>[^\"]*)\")?\\s*\\)")]
    private static partial Regex Image();

    [GeneratedRegex(@"^(\d+)x(\d+)(?:\s*\||$)")]
    private static partial Regex ImageSize();

    [GeneratedRegex("!?\\[(?:[^\\]\\\\]|\\\\.)*\\]\\(\\s*<?(?<href>[^)\\s>]+)>?(?:\\s+(?:\"[^\"]*\"|'[^']*'|\\([^)]*\\)))?\\s*\\)")]
    private static partial Regex InlineLink();

    [GeneratedRegex(@"^[ ]{0,3}\[[^\]]+\]:\s*<?(?<href>[^\s>]+)>?.*$", RegexOptions.Multiline)]
    private static partial Regex RefDefinition();

    [GeneratedRegex(@"<(?<href>(?:https?|mailto):[^>\s]+)>", RegexOptions.IgnoreCase)]
    private static partial Regex AutoLink();

    [GeneratedRegex(@"(?<![\w/.@])(?:https?://|www\.)[^\s<)\]]+", RegexOptions.IgnoreCase)]
    private static partial Regex BareUrl();

    [GeneratedRegex(@"\]\((\/[^)\s]*)\)")]
    private static partial Regex FaqLink();
}
