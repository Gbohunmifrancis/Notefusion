// The screens a post can show, and which one a story gets. Every scene is the real site (web-site/, built
// from content/) in a browser, against a mocked API that serves the committed demo fixtures: Amazing Grace from
// its own hymn page, and Old Hundredth with its four parts (fixtures/old-hundredth.json, the worker's output for
// a synthetic instrument take of the tune). No scene opens the admin console, and no mock carries a real
// person, address, payment or count.

/** Each scene: the page, what to do there before the shot, and the alt text that describes the image. */
export const SCENES = {
  home: {
    path: "/",
    alt: "The NoteFusion home page on a phone: record, upload or paste a link, and get the tune back in tonic solfa and staff notation.",
  },
  "hymns-index": {
    path: "/hymns/",
    alt: "The NoteFusion hymn library on a phone: a searchable list of public-domain hymns, each with its tune in tonic solfa and staff notation.",
  },
  "hymn-page": {
    path: "/hymns/amazing-grace/",
    alt: "The Amazing Grace hymn page on a phone: the tune in tonic solfa line by line with the words, and the staff notation.",
  },
  identify: {
    path: "/hymns/identify/",
    alt: "The hymn finder on a phone after a hummed line: \"This sounds like Amazing Grace\", with the first line, the tune name NEW BRITAIN and a link to its solfa.",
  },
  "app-staff": {
    path: "/app/",
    sheet: "grace",
    alt: "The NoteFusion web app on a phone with Amazing Grace open in staff notation, in 3/4 with its pickup note, and Play, Learn my part and Save buttons below.",
  },
  "app-solfa": {
    path: "/app/",
    sheet: "grace",
    tab: "solfa",
    alt: "The NoteFusion web app on a phone with Amazing Grace in tonic solfa: Doh is G, the notes bar by bar.",
  },
  "app-parts": {
    path: "/app/",
    sheet: "hundredth",
    tab: "parts",
    alt: "The NoteFusion web app on a phone showing Old Hundredth in four parts, soprano, alto, tenor and bass, with a row to hear or mute each voice.",
  },
  practice: {
    path: "/app/",
    sheet: "hundredth",
    tool: "practice",
    alt: "Learn my part in the NoteFusion web app on a phone: pick soprano, alto, tenor or bass, loop a few bars, slow them down, then sing them back.",
  },
  hymnbook: {
    path: "/app/",
    job: "hundredth",
    alt: "A fresh transcription in the NoteFusion web app on a phone, asking \"This sounds like All People That on Earth Do Dwell. Use the hymnbook version?\" above the sheet.",
  },
  "shared-sheet": {
    path: "/app/sheet/?s=demo-sheet",
    alt: "A shared NoteFusion sheet on a phone, opened from a link with no account: Old Hundredth with its parts, ready for a choir to rehearse.",
  },
};

/**
 * Which scene a story gets, from its words (a backlog item names its own). Ordered: the first rule that
 * matches wins. Desktop only when the story is about a desktop surface; everything else is shown on a phone.
 */
const RULES = [
  [/learn my part|practi[cs]e|rehears/i, "practice"],
  [/hum to find|identify|find (?:a|the) hymn|which hymn/i, "identify"],
  [/hymnbook version|hymn recogni|sounds like/i, "hymnbook"],
  [/four parts|harmon|satb|\balto\b|\btenor\b|\bbass\b/i, "app-parts"],
  [/\bshar(?:e|ed|ing)\b|folder|choir/i, "shared-sheet"],
  [/hymn (?:page|tune)s?|\btunes\b|hymn library|cceh|composers?/i, "hymns-index"],
  [/solfa|\bdoh\b|\bkey\b|transpos/i, "app-solfa"],
  [/\bbars?\b|meter|3\/4|pickup|tempo|rhythm|staff/i, "app-staff"],
  [/home ?page|landing|pricing|website|\bblog\b/i, "home"],
];

export function sceneFor(story) {
  if (story.scene && SCENES[story.scene]) return story.scene;
  const text = `${story.title}\n${story.angle || ""}\n${story.facts || ""}`;
  for (const [re, scene] of RULES) if (re.test(story.title || "")) return scene;
  for (const [re, scene] of RULES) if (re.test(text)) return scene;
  return "app-staff";
}

export function viewportFor(story) {
  if (story.viewport === "desktop" || story.viewport === "phone") return story.viewport;
  return /\b(?:desktop|laptop|wide screens?|sidebar)\b/i.test(story.title || "") ? "desktop" : "phone";
}

export const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true, frame: { width: 1080, height: 1350 } },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 2, isMobile: false, hasTouch: false, frame: { width: 1600, height: 1000 } },
};
