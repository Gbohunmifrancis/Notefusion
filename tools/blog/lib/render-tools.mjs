// The free tool pages: /tools and one page for each thing people search for that NoteFusion does (convert a song to
// Tonic Solfa, hum to sheet music, a YouTube song to sheet music, sheet music to solfa, the solfa of a worship song),
// and /compare: NoteFusion beside the apps people name when they search. Each tool page is the tool: the home page's
// own try box (assets/preview.js and its helpers, the same element ids), a 30-second preview with no account, and the
// home page's real sample sheet; then how it works, what it writes, honest limits and the questions people ask.
//
// The searches they answer were read off Google's suggestions and Play's results in October 2026 (docs/STORE_LISTING.md
// keeps the store side). No ads on these pages (`page({ ads: false })`): they are the site's front doors, and the
// apps beside us are rated down for ads. What /compare says of another app comes from its own store listing and
// website, as each page says; never its price, which changes, and never a rating of it.
import { ORIGIN, ASSET_VERSION } from "./site.mjs";
import { escapeHtml } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox, icon } from "./layout.mjs";
import { sheetFigure, SAMPLE_HYMN } from "./render-home.mjs";

export const TOOLS_PATH = "/tools";
/** The pages' own date for the sitemap: change it when the words change, so a rebuild stays byte-for-byte the same. */
export const TOOLS_UPDATED = "2026-10-22";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.notefusion.com";

/**
 * The home page's try box (web-site/index.html #try), the same ids so assets/preview.js drives it. `linkFirst` opens
 * the song-link panel and puts it on top, for the page about links.
 */
function tryBox({ linkFirst = false } = {}) {
  const main = `    <div class="try-main">
      <button class="btn btn-primary" id="try-record" type="button">${icon("mic")}Record a tune</button>
      <label class="btn btn-secondary try-file">
        <input id="try-file" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.webm,audio/*">
        ${icon("upload")}Upload a recording
      </label>
    </div>`;
  const link = `    <details class="try-link" id="try-link"${linkFirst ? " open" : ""}>
      <summary>${icon("link", "ic-16")}${linkFirst ? "Paste a song link" : "Or paste a song link"}${icon("chev-down", "ic-16 try-link-chev")}</summary>
      <form id="try-form" class="try-form" novalidate>
        <label class="sr-only" for="try-url">Song link</label>
        <input id="try-url" type="url" placeholder="Paste a YouTube, Spotify or Apple Music link" autocomplete="off" spellcheck="false" aria-describedby="try-url-error">
        <button class="btn btn-primary" id="try-submit" type="submit">Transcribe</button>
      </form>
      <p class="try-status try-status-error" id="try-url-error" aria-live="polite" hidden></p>
      <button class="btn btn-secondary try-paste" id="try-paste" type="button" hidden>${icon("paste", "ic-16")}Paste a link</button>
      <label class="try-meter" for="try-meter">Beats in a bar <select id="try-meter" data-meter></select></label>
      <p class="try-link-note">Links work for many songs, not all: YouTube sometimes blocks our downloads. If yours fails, upload the audio file instead.</p>
    </details>`;
  return `<div class="home tool-try">
  <div class="try-box" id="try">
${linkFirst ? `${link}\n${main}` : `${main}\n${link}`}
    <div class="try-section" id="try-section"></div>
    <p class="try-status" id="try-status" aria-live="polite"></p>
    <p class="try-note">Your first 30 seconds right here, with no account; an uploaded file is cut to its first 30 seconds. <a class="try-signup" href="/app?signup=1">Create a free account</a> for 3 full transcriptions every week, saved to your library.</p>
  </div>
</div>`;
}

/** The sheet NoteFusion writes, from the home page: the opening of Amazing Grace in solfa, with the same bars on the staff. */
function sample(hymn) {
  return `<div class="home tool-sample">
${sheetFigure(hymn, { id: "sheet-title", staff: "/assets/sample-staff.svg", staffHeight: 236, open: "Open the whole hymn" })}
</div>`;
}

const STYLES = `<link rel="stylesheet" href="/assets/home.css?v=${ASSET_VERSION.homeCss}">
<link rel="stylesheet" href="/assets/tools.css?v=${ASSET_VERSION.toolsCss}">`;
// The try box's scripts, in the home page's order; the picker's and recorder's styles load after the page, as /hymns/identify's do.
const TRY_SCRIPTS = `<link rel="stylesheet" href="/assets/rangepicker.css?v=${ASSET_VERSION.rangepickerCss}">
<link rel="stylesheet" href="/assets/recorder.css?v=${ASSET_VERSION.recorderCss}">
<script src="/assets/songlink.js?v=${ASSET_VERSION.songlinkJs}" defer></script>
<script src="/assets/rangepicker.js?v=${ASSET_VERSION.rangepickerJs}" defer></script>
<script src="/assets/back.js?v=${ASSET_VERSION.backJs}" defer></script>
<script src="/assets/recorder.js?v=${ASSET_VERSION.recorderJs}" defer></script>
<script src="/assets/meter.js?v=${ASSET_VERSION.meterJs}" defer></script>
<script src="/assets/preview.js?v=${ASSET_VERSION.previewJs}" defer></script>`;

/* ── The pages ──────────────────────────────────────────────────────────────── */

/**
 * Each tool page: where it lives, its title and description (the search result), the heading and the line under it,
 * the body (after the try box and the sample), its questions, and the blog guides it points to (each only once the
 * build has the post: the committed site is built without the API's posts).
 */
const TOOLS = [
  {
    slug: "tonic-solfa-converter",
    name: "Tonic Solfa converter",
    title: "Tonic Solfa Converter: Turn Any Song into Solfa | NoteFusion",
    description: "Convert a song or recording to Tonic Solfa: sing it, hum it, upload it or paste a song link, and get the solfa notes with the staff notation, in its key.",
    h1: "Convert any song to Tonic Solfa",
    dek: "Sing it, hum it, upload the recording or paste a song link. NoteFusion listens, finds the doh and writes the tune out in Tonic Solfa, with the staff notation under it.",
    summary: "Any song or recording written out in solfa, in its key.",
    body: () => `<h2>How to convert a song to Tonic Solfa</h2>
<ol>
  <li><strong>Bring the tune in.</strong> Record yourself singing or humming it, upload a recording from your phone, or paste a YouTube, Spotify or Apple Music link. The first 30 seconds work right here, with no account.</li>
  <li><strong>NoteFusion writes it out.</strong> It hears the notes and how long each is held, finds the key and puts doh where the key says, then writes the tune in bars with its time signature.</li>
  <li><strong>Check it and use it.</strong> Play it back, correct a note, move the doh if your hymn book has it elsewhere, transpose it for your choir, and download a PDF to print or share.</li>
</ol>

<h2>Solfa the way a hymn book writes it</h2>
<ul>
  <li><strong>Movable doh.</strong> Doh is the key note, in every one of the 24 keys: in G major doh is G, in B♭ doh is B♭, and the sheet says which at the top.</li>
  <li><strong>La-based minor.</strong> A tune in A minor reads l, t, d with doh on C, as tonic solfa singers learn it.</li>
  <li><strong>Chromatic notes named for where they go:</strong> de, re, fe, se and le on the way up; ra, ma, sa, la and ta on the way down.</li>
  <li><strong>Octave marks</strong> on every note: d' above, s, below, so nobody guesses the register.</li>
  <li><strong>Staff notation of the same notes</strong> under the solfa, for the pianist and the instrumentalists.</li>
</ul>
<p>Not sure which doh it is? When a tune could sit in more than one key, NoteFusion says so and lets you choose, instead of guessing.</p>

<h2>What converts well</h2>
<ul>
  <li><strong>One voice or one instrument</strong>, sung or played clearly: a hummed tune, a soloist, a keyboard melody.</li>
  <li><strong>A song with a band.</strong> The singer is separated from the instruments first, then written out. This needs Pro or a song bought on its own.</li>
  <li><strong>A choir singing in parts.</strong> Choir mode writes soprano, alto, tenor and bass as separate lines.</li>
</ul>
<p>Dense mixes, very fast runs and a voice buried under loud instruments come out less cleanly. Sing on "la" or the words, steadily, in a quiet room, and the solfa comes out close to what you meant.</p>

<h2>What is free</h2>
<p>Your first 30 seconds on this page need no account. A free account gives you 3 full transcriptions every week, of anything you record or upload (a file is read for its first three minutes), with no card. Whole songs from a link, and recordings with a band, need Pro, or you can buy just that one song. There are no ads in the app.</p>`,
    faq: [
      { q: "Can I convert a song to Tonic Solfa for free?", a: "Yes. Try 30 seconds here with no account, then create a free account for 3 full transcriptions every week. Anything you hum, sing, play or upload counts; whole songs from a YouTube or Spotify link need Pro or a single-song purchase." },
      { q: "Does it work for worship songs and hymns?", a: "Yes. Sing or play the song, or upload a recording of your church singing it, and you get its solfa in the key it was sung in. For over 250 hymns we have already written the solfa out, with the words: browse them at notefusion.studio/hymns." },
      { q: "Which doh does it use?", a: "Movable doh: doh is the key note of the key the tune is in, and minor keys are la-based. If the tune could be read in more than one key, NoteFusion offers the likely dohs and you choose. You can also move the key afterwards; the solfa stays the same and only the staff moves." },
      { q: "Can it convert staff notation to Tonic Solfa?", a: "Yes. Photograph the printed music or upload the PDF in the web app (the Sheet music tab), or import a MusicXML, MIDI or ABC file in the Android app (Record, then Import). See the sheet music to Tonic Solfa page for the details and a key-to-doh chart." },
      { q: "Do I need to install anything?", a: "No. Everything works in the browser at notefusion.studio/app. The Android app does the same with the same account, and keeps your sheets on the phone for when you are offline." },
    ],
    guides: ["how-to-transcribe-a-song-into-tonic-solfa", "how-to-find-the-doh-of-a-song", "how-to-read-tonic-solfa", "what-is-movable-doh", "chromatic-notes-in-tonic-solfa"],
  },
  {
    slug: "hum-to-sheet-music",
    name: "Hum to sheet music",
    title: "Hum to Sheet Music: Turn Humming into Notes | NoteFusion",
    description: "Hum, whistle or sing a tune and get it as sheet music and Tonic Solfa: the notes, the key, the rhythm and the bars. Free in your browser or on Android.",
    h1: "Hum a tune, get the sheet music",
    dek: "Hum it, whistle it or sing it on “la”. NoteFusion writes down what you sang as staff notation and Tonic Solfa: the notes, the key, the rhythm and the bars.",
    summary: "A hummed or sung tune as staff notation and solfa.",
    body: () => `<h2>How to turn humming into sheet music</h2>
<ol>
  <li><strong>Press Record a tune</strong> and hum, whistle or sing the melody. Here you have 30 seconds with no account; a free account records up to three minutes, and you can upload a voice note you already have.</li>
  <li><strong>Listen back</strong> and send it, or record it again.</li>
  <li><strong>Read the sheet:</strong> the notes on the staff and in solfa, in bars, with the key and the time signature. Play it back, fix any note you meant differently, and download it.</li>
</ol>

<h2>Made for voices, not only pianos</h2>
<p>Most note detectors are tuned for instruments, so a voice comes back as a scatter of wrong notes and accidentals. NoteFusion reads a voice as a voice: a scoop up to a note, vibrato on a held note and a line sung a little sharp are written as the notes you meant. A long take that drifts slowly out of tune is followed, and the tune stays in one key.</p>

<h2>Tips for humming that comes out right</h2>
<ul>
  <li><strong>Hum on a syllable.</strong> “Da”, “la” or the words give each note a clear start; a closed-mouth hum blurs repeated notes together.</li>
  <li><strong>One line at a time</strong>, at a steady pace. Any key and any speed is fine.</li>
  <li><strong>A quiet room</strong>, with the phone or laptop near you and no music playing in the background.</li>
  <li><strong>Start at the beginning</strong> of a phrase, so the first bar line lands in the right place.</li>
</ul>

<h2>What you can do with the sheet</h2>
<ul>
  <li>Transpose it to suit your voice or your choir; the solfa reads the same in every key.</li>
  <li>Download a PDF to print or share; MIDI and MusicXML for MuseScore, Sibelius or your music software come with Pro.</li>
  <li>Ask for alto, tenor and bass parts under your tune (Pro, with one free to try), and learn each part with your own part loud and the others soft.</li>
</ul>`,
    faq: [
      { q: "Can I turn a voice memo into sheet music?", a: "Yes. Upload the voice note or recording from your phone (MP3, M4A, WAV, OGG, FLAC or WebM). A free account reads its first three minutes, Pro up to six." },
      { q: "What if I can't sing in tune?", a: "Sing it as well as you can. NoteFusion writes each note as the scale tone you were aiming for unless you clearly sang a different one, and it follows a voice that drifts slowly flat or sharp over a long take." },
      { q: "Is it free?", a: "Your first 30 seconds here need no account, and a free account gives you 3 full transcriptions every week, no card needed. Pro adds songs from links, parts and every download format." },
      { q: "Does it work for whistling or an instrument?", a: "Yes. Whistling, a flute, a violin or a keyboard melody work the same way. For a song with a band, the singer is separated from the instruments first (Pro, or buy that one song)." },
    ],
    guides: ["how-to-read-tonic-solfa", "time-signatures-for-choir-singers", "what-is-a-pickup-note", "how-to-read-staff-notation-if-you-know-solfa"],
  },
  {
    slug: "youtube-to-sheet-music",
    name: "YouTube to sheet music",
    title: "YouTube to Sheet Music and Tonic Solfa Converter | NoteFusion",
    description: "Paste a YouTube, Spotify or Apple Music link and get the song's melody as sheet music and Tonic Solfa. The singer is separated from the band first.",
    h1: "Turn a YouTube song into sheet music",
    dek: "Paste a link from YouTube, Spotify or Apple Music and choose the part of the song you want. NoteFusion separates the singer from the band and writes the tune out in staff notation and Tonic Solfa.",
    summary: "A song's melody from a link, as sheet music and solfa.",
    linkFirst: true,
    body: () => `<h2>How it works</h2>
<ol>
  <li><strong>Paste the link.</strong> NoteFusion finds the song and how long it is.</li>
  <li><strong>Choose the part you want</strong>: the verse, the chorus, or the whole song up to six minutes with Pro.</li>
  <li><strong>The singer is separated from the band</strong>, and the tune is written out: the notes, the key and doh, and bars that follow the band's beat, starting from the first note sung.</li>
</ol>

<h2>What it writes, and what it doesn't</h2>
<p>NoteFusion writes the song's melody: the line the lead singer sings, which is what a choir or a keyboard player needs to learn the song. It does not write every instrument in the band. A song with one clear lead voice comes out best; a duet, a crowd or a voice buried under loud instruments less cleanly.</p>
<p>Links work for many songs, not all. YouTube sometimes refuses our downloads, and private, live, age-restricted and very long videos can't be read. If a link fails it costs you nothing: upload the audio file instead, or try a different upload of the same song.</p>

<h2>What it costs</h2>
<p>The 30-second preview on this page is free, with no account, once per device. A whole song from a link (up to six minutes, with the singer separated from the band) needs Pro, which includes 20 songs a month, or you can buy just that one song with no subscription. Anything you hum, sing or upload yourself is covered by a free account's 3 a week.</p>`,
    faq: [
      { q: "Does it work with Spotify and Apple Music links?", a: "Yes. NoteFusion reads the song's name from the link and finds a recording of it to transcribe, so a Spotify or Apple Music link works as a YouTube one does." },
      { q: "Why did my YouTube link fail?", a: "YouTube sometimes blocks downloads, and private, live, age-restricted and over-long videos can't be read. A failed link costs nothing. Upload the audio file instead, or paste a different upload of the same song." },
      { q: "Can I use the sheet music I make?", a: "NoteFusion makes the sheet for your own practice and rehearsal. The song's copyright stays with its owners, so printing it for others or publishing it may need their permission or your church's licence." },
      { q: "How long a song can it do?", a: "The free preview reads 30 seconds. With Pro, or a song bought on its own, a link is read for up to six minutes, so most songs fit whole; you can also pick just the section you want." },
    ],
    guides: ["how-to-transcribe-a-song-into-tonic-solfa", "how-to-teach-a-choir-a-new-song", "how-to-find-the-doh-of-a-song"],
  },
  {
    slug: "sheet-music-to-tonic-solfa",
    name: "Sheet music to Tonic Solfa",
    title: "Convert Sheet Music to Tonic Solfa from a Photo or PDF | NoteFusion",
    description: "Convert sheet music to Tonic Solfa: photograph the printed page or upload the PDF, and NoteFusion reads the tune and writes it in solfa.",
    h1: "Convert sheet music to Tonic Solfa",
    dek: "Have the staff notation but read from solfa? Photograph the page or upload the PDF, and NoteFusion reads the tune off it and writes it in Tonic Solfa, with doh where the key puts it.",
    summary: "A photo or PDF of staff notation, or a score file, rewritten in solfa.",
    body: () => `<h2>From a photo or a PDF</h2>
<p>In the <a href="/app?source=sheet&amp;signup=1" data-track="Tool: sheet music">NoteFusion web app</a>, open the <strong>Sheet music</strong> tab and choose a photo of the page (JPEG, PNG or WebP) or the PDF; a PDF is read for its first four pages. NoteFusion reads the tune off the staff and writes it in Tonic Solfa, with the staff notation under it. It needs a free account, and counts as one of your transcriptions.</p>
<ul>
  <li><strong>It reads the tune:</strong> the top line of the top staff. Alto, tenor and bass are not read off the page; on Pro, NoteFusion can write them under the tune for you.</li>
  <li><strong>Printed music reads best.</strong> Take the photo straight on, in good light, with the whole staff in the frame. Handwritten music is unlikely to read well.</li>
  <li><strong>Check the notes against the page.</strong> On photographed hymn-book pages it got 99 in every 100 notes right; on old, faded scans fewer, and note lengths suffer most. NoteFusion asks you to look it over before you rely on it.</li>
</ul>

<h2>Other ways to convert it</h2>
<ol>
  <li><strong>From a file:</strong> a MusicXML, MIDI or ABC file, the kind MuseScore, Sibelius, Finale and Dorico export and many hymn websites offer. In the NoteFusion Android app, open Record, then Import, and choose the file. NoteFusion reads the notes straight from the score, so the solfa is exact; it counts as one of your transcriptions.</li>
  <li><strong>By playing it in:</strong> play it on a keyboard or sing it into the recorder above, and NoteFusion writes the solfa from what it hears.</li>
  <li><strong>From our hymnal:</strong> over 250 hymns with their words, and over 500 more hymn tunes, are already written out in Tonic Solfa beside their staff notation. <a href="/hymns">Find yours in the hymns</a>.</li>
</ol>

<h2>Find the doh from the key signature</h2>
<p>Converting by hand starts here: the key signature tells you which note is doh. With sharps, the last sharp is te, so doh is the note a semitone above it. With flats, the last flat but one is doh (with one flat, doh is F).</p>
<table>
  <thead><tr><th scope="col">Key signature</th><th scope="col">Doh (major)</th><th scope="col">Lah (minor)</th></tr></thead>
  <tbody>
    <tr><td>No sharps or flats</td><td>C</td><td>A</td></tr>
    <tr><td>1 sharp</td><td>G</td><td>E</td></tr>
    <tr><td>2 sharps</td><td>D</td><td>B</td></tr>
    <tr><td>3 sharps</td><td>A</td><td>F♯</td></tr>
    <tr><td>4 sharps</td><td>E</td><td>C♯</td></tr>
    <tr><td>5 sharps</td><td>B</td><td>G♯</td></tr>
    <tr><td>6 sharps</td><td>F♯</td><td>D♯</td></tr>
    <tr><td>1 flat</td><td>F</td><td>D</td></tr>
    <tr><td>2 flats</td><td>B♭</td><td>G</td></tr>
    <tr><td>3 flats</td><td>E♭</td><td>C</td></tr>
    <tr><td>4 flats</td><td>A♭</td><td>F</td></tr>
    <tr><td>5 flats</td><td>D♭</td><td>B♭</td></tr>
    <tr><td>6 flats</td><td>G♭</td><td>E♭</td></tr>
  </tbody>
</table>
<p>A tune in a minor key keeps the same doh as its relative major and is read la-based: it centres on lah, the note in the last column. From there, count up the scale: d r m f s l t d'. A sharpened note becomes de, re, fe, se or le; a flattened one ra, ma, sa, la or ta.</p>

<h2>Then the rhythm</h2>
<p>In Tonic Solfa a bar line is <code>|</code>, a beat begins at <code>:</code>, a note held on is <code>-</code>, and a beat split in two is written with a full stop between the halves: <code>d.r</code>. NoteFusion writes all of it for you, and the staff notation stays under the solfa so you can check one against the other.</p>`,
    faq: [
      { q: "Can I convert a PDF of sheet music to Tonic Solfa?", a: "Yes. In the NoteFusion web app, open the Sheet music tab and upload the PDF, or a photo of the page. NoteFusion reads the tune off its first four pages and writes it in Tonic Solfa with the staff under it; check the notes against the page before you rely on them." },
      { q: "Does it read all four parts?", a: "No: it reads the tune, the top line of the top staff. On Pro, NoteFusion can write alto, tenor and bass under the tune." },
      { q: "Is the solfa from a file exact?", a: "Yes. From a MusicXML, MIDI or ABC file NoteFusion reads the written notes and rhythm directly, so nothing is guessed from a recording; it then names each note from the key." },
      { q: "How is a minor key written in Tonic Solfa?", a: "La-based: a minor key keeps the doh of its relative major and the tune centres on lah. A tune in A minor reads l, t, d, with doh on C. NoteFusion writes minor keys this way." },
      { q: "Where do I import a file?", a: "In the NoteFusion Android app: open Record, then Import, and choose a MusicXML (.musicxml, .xml, .mxl), MIDI (.mid) or ABC (.abc) file." },
    ],
    guides: ["how-to-read-staff-notation-if-you-know-solfa", "key-signatures-explained-for-singers", "la-based-minor-explained", "chromatic-notes-in-tonic-solfa", "how-to-read-rhythm-in-tonic-solfa", "tonic-solfa-vs-staff-notation"],
  },
  {
    slug: "tonic-solfa-of-worship-songs",
    name: "Tonic Solfa of worship songs",
    title: "Tonic Solfa of Worship Songs: Get Any Song's Solfa | NoteFusion",
    description: "Get the Tonic Solfa of any worship song: sing it, upload your recording or paste its link, and get the solfa in your key. Over 250 hymns are written out.",
    h1: "The Tonic Solfa of any worship song",
    dek: "Most praise and worship songs are never printed in solfa. Sing the song, upload a recording or paste its link, and NoteFusion writes its Tonic Solfa for your choir, your keyboard or your band.",
    summary: "Any praise and worship song in solfa, in your key.",
    body: ({ hymnsBySlug }) => `<h2>Why make your own instead of searching for it</h2>
<p>A list of worship songs in solfa is hard to find and rarely in the key your church sings. A recording of your own choir, or the version your band plays, gives you the solfa as you actually sing it. And most praise and worship songs are still under copyright, so we don't publish their solfa here: you make your copy from the recording you have, for your own practice and rehearsal. If your church prints or projects copies, check your licence (for example, CCLI).</p>

<h2>How to get a worship song's solfa</h2>
<ol>
  <li><strong>Choose the recording.</strong> Sing the song yourself, upload a recording of your choir or band, or paste the song's YouTube, Spotify or Apple Music link.</li>
  <li><strong>Pick the part you need</strong>: the verse, the chorus or the bridge.</li>
  <li><strong>Get the solfa</strong> with the staff notation, in the key of the recording. Move it to your choir's key in a tap; the solfa stays the same, only doh moves.</li>
</ol>
<p>A song with a band needs the singer separated from the instruments first: that is Pro, or buy just that one song. Anything you sing or record yourself is covered by a free account's 3 transcriptions a week.</p>

<h2>Hymns, already written out</h2>
<p>For the great hymns, the solfa is ready: the full tune with the words of every verse, the staff notation, a piano to sing along with and a printable PDF.</p>
<ul class="tool-hymns">
${WORSHIP_HYMNS.map((slug) => {
  const h = hymnsBySlug.get(slug);
  return `  <li><a href="/hymns/${h.slug}">${escapeHtml(h.view.title || h.title)}</a> <span>${escapeHtml(h.view.header)}</span></li>`;
}).join("\n")}
</ul>
<p><a href="/hymns">Browse all the hymns</a>, or <a href="/hymns/identify">hum one to find it</a>.</p>

<h2>For the keyboard player</h2>
<p>If your keyboard is set to transpose, tell NoteFusion and it writes the notes as you will press them, while the solfa stays as the choir sings it.</p>`,
    faq: [
      { q: "Can you send me the solfa of a particular worship song?", a: "We don't publish the solfa of songs still under copyright. Sing the song or paste its link here and NoteFusion writes it out for you in a few minutes, in the key of the recording." },
      { q: "Will it be in the key my church sings it in?", a: "It is written in the key of the recording you give it. If your choir sings it lower or higher, transpose it in one tap: the solfa your singers read stays the same, only doh moves." },
      { q: "Can I get the alto, tenor and bass parts?", a: "Yes. Ask for parts and NoteFusion writes alto, tenor and bass under the tune, the way a hymn book prints them (Pro, with one free to try). A recording of your choir singing in parts can also be read in choir mode, which writes each part it hears." },
      { q: "Is it free?", a: "Your first 30 seconds here need no account. A free account gives you 3 full transcriptions a week of anything you sing, record or upload. Songs from a link need Pro, or buy that one song." },
    ],
    guides: ["how-to-teach-a-choir-a-new-song", "satb-parts-explained", "tonic-solfa-for-keyboard-players", "how-to-choose-the-right-key-for-your-choir", "how-to-find-the-doh-of-a-song"],
  },
];

/** The hymns the worship-songs page lists, in the order people sing them most; every one must be published. */
const WORSHIP_HYMNS = [
  "amazing-grace", "to-god-be-the-glory", "what-a-friend-we-have-in-jesus", "blessed-assurance", "it-is-well-with-my-soul",
  "abide-with-me", "all-hail-the-power-of-jesus-name", "holy-holy-holy", "a-mighty-fortress-is-our-god", "crown-him-with-many-crowns",
  "praise-my-soul-the-king-of-heaven", "guide-me-o-thou-great-jehovah", "o-god-our-help-in-ages-past", "when-i-survey-the-wondrous-cross",
  "nearer-my-god-to-thee", "pass-me-not-o-gentle-saviour", "joyful-joyful-we-adore-thee", "jesus-loves-me",
];

/**
 * The comparisons. What each says of the other app is what that app's own listing or website says (October 2026), and
 * each page names its source; nothing about its price or its ratings.
 */
const COMPARISONS = [
  {
    slug: "sing2notes-alternative",
    other: "Sing2Notes",
    maker: "Klangio",
    title: "A Sing2Notes Alternative with Tonic Solfa | NoteFusion",
    description: "Looking for a Sing2Notes alternative? NoteFusion turns singing into sheet music and Tonic Solfa, with choir parts, hymns and 3 full transcriptions a week.",
    h1: "A Sing2Notes alternative for solfa and choirs",
    dek: "Sing2Notes and NoteFusion both turn a sung recording into sheet music. NoteFusion also writes it in Tonic Solfa, and is built around choirs: parts, hymns and learning your line.",
    source: "Sing2Notes' Google Play and App Store listings",
    theyDo: [
      "Turns a vocal recording into staff notation, from the microphone, a file or a YouTube link.",
      "Exports PDF, MIDI and MusicXML for MuseScore, Sibelius and music software.",
      "Has a desktop version in the browser and sister apps for piano, guitar and drums.",
    ],
    rows: [
      ["Staff notation from singing", "Yes", "Yes"],
      ["Tonic Solfa (movable doh)", "Yes, the hymn-book way", "Not in its listing"],
      ["Choir parts (soprano, alto, tenor, bass)", "Written under a tune, or heard from a choir", "Not in its listing"],
      ["Hymns written out in solfa", "Over 250 with words, 500 more tunes", "Not in its listing"],
      ["Song links", "YouTube, Spotify, Apple Music", "YouTube"],
      ["Free to try", "3 full transcriptions a week, no card", "Free demo transcriptions"],
      ["Pay for one song", "Yes, no subscription", "Tickets or a subscription"],
      ["Practice with marking", "Ear training path; sing your part back (Pro)", "Not in its listing"],
    ],
    choose: "Choose Sing2Notes if you write songs in a music program and want MIDI from your voice, with the rest of Klangio's apps beside it. Choose NoteFusion if your singers read Tonic Solfa, or you lead a choir or a worship team and want the parts, the hymns and a way for each singer to learn their line.",
  },
  {
    slug: "melody-scanner-alternative",
    other: "Melody Scanner",
    maker: "Klangio",
    title: "A Melody Scanner Alternative for Singing and Solfa | NoteFusion",
    description: "Melody Scanner is built for solo instruments. NoteFusion writes singing, hums and songs as sheet music and Tonic Solfa, with choir parts and hymns.",
    h1: "A Melody Scanner alternative for voices and solfa",
    dek: "Melody Scanner turns solo instrument recordings into scores. NoteFusion is built for voices first: a hummed tune, a soloist, a choir or a song with a band, written in staff notation and Tonic Solfa.",
    source: "Melody Scanner's Google Play listing",
    theyDo: [
      "Transcribes solo piano and flute, with violin and acoustic guitar in beta, from the microphone, YouTube or a file.",
      "Shows the result as a score, a piano roll or guitar tab, and exports PDF, MIDI and MusicXML.",
      "Syncs with a desktop version.",
    ],
    rows: [
      ["Made for", "Voices first, and instruments", "Solo instruments (its listing: “no bands or orchestras”)"],
      ["A song with a band", "The singer is separated, then written out", "Not supported, per its listing"],
      ["Tonic Solfa (movable doh)", "Yes, the hymn-book way", "Not in its listing"],
      ["Choir parts (soprano, alto, tenor, bass)", "Written under a tune, or heard from a choir", "Not in its listing"],
      ["Upload your own file", "Free, 3 a week", "Premium, per its listing"],
      ["Free to try", "3 full transcriptions a week, no card", "Microphone and YouTube, up to 40 bars"],
      ["Guitar tab", "No", "Yes"],
    ],
    choose: "Choose Melody Scanner for a piano or flute piece you want as a score or guitar tab. Choose NoteFusion for anything sung or hummed, for songs with a band, and for Tonic Solfa, choir parts and hymns.",
  },
  {
    slug: "scorecloud-alternative",
    other: "ScoreCloud",
    maker: "DoReMIR",
    title: "A ScoreCloud Alternative on Android and the Web | NoteFusion",
    description: "Looking for a ScoreCloud alternative? NoteFusion turns singing, humming and song links into sheet music and Tonic Solfa, on Android and in any browser.",
    h1: "A ScoreCloud alternative for Android, the web and solfa",
    dek: "ScoreCloud writes sheet music from what you sing or play, on Windows, Mac, iPhone and iPad. NoteFusion does it on Android and in any browser, in staff notation and Tonic Solfa, with choir parts and hymns.",
    source: "scorecloud.com",
    theyDo: [
      "ScoreCloud Studio and Songwriter for Windows and Mac, and ScoreCloud Express for iPhone and iPad.",
      "Writes sheet music from singing, humming or playing; Songwriter also takes MP3s and YouTube and makes lead sheets.",
      "Free in Studio up to 10 saved songs; paid plans for more.",
    ],
    rows: [
      ["Android", "Yes", "Not on its website"],
      ["In the browser", "Yes, the whole app", "A web player for sharing"],
      ["Tonic Solfa (movable doh)", "Yes, the hymn-book way", "Not on its website"],
      ["Choir parts (soprano, alto, tenor, bass)", "Written under a tune, or heard from a choir", "Arrangements, per its website"],
      ["Song links", "YouTube, Spotify, Apple Music", "YouTube, in Songwriter"],
      ["Hymns written out in solfa", "Over 250 with words, 500 more tunes", "Not on its website"],
      ["Free to try", "3 full transcriptions a week, no card", "Studio free up to 10 saved songs"],
    ],
    choose: "Choose ScoreCloud on a Mac or PC if you want a full notation editor and play a MIDI keyboard. Choose NoteFusion on an Android phone or in a browser, and whenever your singers read Tonic Solfa.",
  },
];

/* ── Rendering ──────────────────────────────────────────────────────────────── */

/** The blog guides a page points to: only those the build has (the committed site has none; the deploy has them all). */
function guideLinks(slugs, postsBySlug) {
  const found = slugs.map((s) => postsBySlug.get(s)).filter(Boolean);
  if (!found.length) return "";
  return `<h2>Guides</h2>
<ul class="tool-links">
${found.map((p) => `  <li><a href="${p.url}">${escapeHtml(p.title)}</a></li>`).join("\n")}
</ul>`;
}

/** The other tools and comparisons, on every page. */
function otherTools(current) {
  const tools = TOOLS.filter((t) => t.slug !== current).map((t) => `  <li><a href="${TOOLS_PATH}/${t.slug}">${escapeHtml(t.name)}</a> <span>${escapeHtml(t.summary)}</span></li>`);
  tools.push(`  <li><a href="/hymns/identify">Hum to find a hymn</a> <span>Hum a few bars and find which hymn it is.</span></li>`);
  return `<h2>More free tools</h2>
<ul class="tool-links">
${tools.join("\n")}
</ul>`;
}

function faqSection(faq) {
  return `<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions</h2>
${faq.map((f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>`;
}

const faqLd = (faq) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });

const appLd = (name, path, description) => ({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name,
  url: ORIGIN + path,
  description,
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any (web browser), Android",
  browserRequirements: "Requires JavaScript; a microphone to record.",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@type": "Organization", name: "NoteFusion", url: ORIGIN + "/" },
});

function renderTool(t, { hymnsBySlug, postsBySlug }) {
  const path = `${TOOLS_PATH}/${t.slug}`;
  const crumbs = [["/", "Home"], [TOOLS_PATH, "Free tools"], [path, t.name]];
  const body = `${breadcrumbs(crumbs)}
<article class="post">
  <header class="post-header">
    <p class="kicker">Free tool</p>
    <h1>${escapeHtml(t.h1)}</h1>
    <p class="post-lede">${escapeHtml(t.dek)}</p>
  </header>
${tryBox({ linkFirst: t.linkFirst })}
${sample(hymnsBySlug.get(SAMPLE_HYMN))}
  <div class="post-body">
${t.body({ hymnsBySlug })}
  </div>
${faqSection(t.faq)}
  <div class="post-body">
${otherTools(t.slug)}
${guideLinks(t.guides, postsBySlug)}
  </div>
${ctaBox("tool-" + t.slug)}
</article>`;
  return page({
    path, title: t.title, description: t.description, body, bodyClass: "tool-page", ads: false, head: STYLES, scripts: TRY_SCRIPTS,
    jsonLd: [appLd(t.name, path, t.description), breadcrumbLd(crumbs), faqLd(t.faq)],
  });
}

function compareFaq(c) {
  return [
    { q: `Is NoteFusion free like ${c.other}?`, a: "NoteFusion gives every free account 3 full transcriptions a week, of anything you sing, hum, play or upload, with no card. Songs from a link need Pro, or you can buy one song on its own." },
    { q: `Does ${c.other} write Tonic Solfa?`, a: `Its own listing and website don't mention Tonic Solfa (checked in October 2026). NoteFusion writes every transcription in movable-doh Tonic Solfa beside the staff notation.` },
    { q: "Can I open my sheets in MuseScore or Sibelius?", a: "Yes. NoteFusion exports MusicXML and MIDI with Pro, and a PDF on every plan." },
  ];
}

function renderComparison(c, { hymnsBySlug }) {
  const path = `/compare/${c.slug}`;
  const crumbs = [["/", "Home"], [TOOLS_PATH, "Free tools"], [path, `${c.other} alternative`]];
  const faq = compareFaq(c);
  const body = `${breadcrumbs(crumbs)}
<article class="post">
  <header class="post-header">
    <p class="kicker">Compare</p>
    <h1>${escapeHtml(c.h1)}</h1>
    <p class="post-lede">${escapeHtml(c.dek)}</p>
  </header>
  <div class="post-body">
<h2>NoteFusion and ${escapeHtml(c.other)} side by side</h2>
<div class="tool-table">
<table>
  <thead><tr><th scope="col"></th><th scope="col">NoteFusion</th><th scope="col">${escapeHtml(c.other)}</th></tr></thead>
  <tbody>
${c.rows.map(([what, us, them]) => `    <tr><th scope="row">${escapeHtml(what)}</th><td>${escapeHtml(us)}</td><td>${escapeHtml(them)}</td></tr>`).join("\n")}
  </tbody>
</table>
</div>
<p class="tool-source">What this page says of ${escapeHtml(c.other)} comes from ${escapeHtml(c.source)}, as of October 2026, and may have changed since. ${escapeHtml(c.other)} is made by ${escapeHtml(c.maker)}, which has nothing to do with NoteFusion.</p>

<h2>What ${escapeHtml(c.other)} does well</h2>
<ul>
${c.theyDo.map((line) => `  <li>${escapeHtml(line)}</li>`).join("\n")}
</ul>

<h2>What NoteFusion adds</h2>
<ul>
  <li><strong>Tonic Solfa on every sheet</strong>, written the hymn-book way: movable doh from the key, la-based minor, chromatics named de, ra, fe, ta, and octave marks.</li>
  <li><strong>Choirs:</strong> alto, tenor and bass written under any tune, a recording of a choir read part by part, and Learn my part, with your line loud and the others soft.</li>
  <li><strong>Hymns:</strong> over 250 hymns with their words and 500 more hymn tunes in solfa and staff, and a hum to find one.</li>
  <li><strong>A fair free plan:</strong> 3 full transcriptions every week, a file read for its first three minutes, no card, no ads in the app; and one song bought on its own when that is all you need.</li>
  <li><strong>On Android and in any browser</strong>, with the same account and your sheets kept on the phone for offline.</li>
</ul>

<h2>Which to choose</h2>
<p>${escapeHtml(c.choose)}</p>
  </div>
${tryBox()}
${sample(hymnsBySlug.get(SAMPLE_HYMN))}
${faqSection(faq)}
  <div class="post-body">
${otherTools(null)}
  </div>
${ctaBox("compare-" + c.slug)}
</article>`;
  return page({
    path, title: c.title, description: c.description, body, bodyClass: "tool-page", ads: false, head: STYLES, scripts: TRY_SCRIPTS,
    jsonLd: [breadcrumbLd(crumbs), faqLd(faq)],
  });
}

function renderToolsIndex() {
  const crumbs = [["/", "Home"], [TOOLS_PATH, "Free tools"]];
  const description = "Free music tools: convert a song to Tonic Solfa, hum to sheet music, turn a YouTube song or staff notation into solfa, and find a hymn by humming.";
  const body = `${breadcrumbs(crumbs)}
<article class="post">
  <header class="post-header">
    <h1>Free music tools</h1>
    <p class="post-lede">Turn what you sing, hum, play or hear into Tonic Solfa and sheet music. Each tool works in your browser, with 30 seconds free and no account.</p>
  </header>
  <div class="post-body">
<ul class="tool-links tool-links-big">
${TOOLS.map((t) => `  <li><a href="${TOOLS_PATH}/${t.slug}">${escapeHtml(t.name)}</a> <span>${escapeHtml(t.summary)}</span></li>`).join("\n")}
  <li><a href="/hymns/identify">Hum to find a hymn</a> <span>Hum a few bars and find which hymn it is.</span></li>
</ul>
<h2>Comparing apps</h2>
<ul class="tool-links">
${COMPARISONS.map((c) => `  <li><a href="/compare/${c.slug}">NoteFusion and ${escapeHtml(c.other)}</a> <span>${escapeHtml(c.description.split(". ")[0].replace(/\?$/, ""))}.</span></li>`).join("\n")}
</ul>
  </div>
${ctaBox("tools")}
</article>`;
  const list = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: TOOLS.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: `${ORIGIN}${TOOLS_PATH}/${t.slug}` })),
  };
  return page({
    path: TOOLS_PATH, title: "Free Music Tools: Tonic Solfa and Sheet Music | NoteFusion", description, body, bodyClass: "tool-page", ads: false,
    head: `<link rel="stylesheet" href="/assets/tools.css?v=${ASSET_VERSION.toolsCss}">`, jsonLd: [breadcrumbLd(crumbs), list],
  });
}

/**
 * Every page here, as [urlPath, html]. `hymnsBySlug` must hold the sample hymn and every hymn the worship page lists;
 * `posts` are the blog's (the guides each page points to are linked only when present).
 */
export function renderToolPages({ hymnsBySlug, posts = [] }) {
  for (const slug of [SAMPLE_HYMN, ...WORSHIP_HYMNS]) if (!hymnsBySlug.get(slug)) throw new Error(`the tool pages need the published hymn ${slug}`);
  const postsBySlug = new Map(posts.map((p) => [p.slug, p]));
  return [
    [TOOLS_PATH, renderToolsIndex()],
    ...TOOLS.map((t) => [`${TOOLS_PATH}/${t.slug}`, renderTool(t, { hymnsBySlug, postsBySlug })]),
    ...COMPARISONS.map((c) => [`/compare/${c.slug}`, renderComparison(c, { hymnsBySlug })]),
  ];
}

/** The sitemap's entries for these pages. */
export function toolSitemapEntries() {
  return [
    { loc: ORIGIN + TOOLS_PATH, lastmod: TOOLS_UPDATED, changefreq: "monthly", priority: "0.8" },
    ...TOOLS.map((t) => ({ loc: `${ORIGIN}${TOOLS_PATH}/${t.slug}`, lastmod: TOOLS_UPDATED, changefreq: "monthly", priority: "0.9" })),
    ...COMPARISONS.map((c) => ({ loc: `${ORIGIN}/compare/${c.slug}`, lastmod: TOOLS_UPDATED, changefreq: "monthly", priority: "0.6" })),
  ];
}

/** The tool pages' paths, for the footers' links. */
export const TOOL_LINKS = TOOLS.map((t) => [`${TOOLS_PATH}/${t.slug}`, t.name]);
