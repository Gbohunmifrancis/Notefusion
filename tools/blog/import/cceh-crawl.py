"""Downloads the Christian Classics Ethereal Hymnary's tunes for the CCEH importer (cceh-run.mjs).

    python3 -I tools/blog/import/cceh-crawl.py CACHE_DIR      (a directory outside the repository)

Politely: one request at a time, 11 seconds apart (CCEL's robots.txt asks for a crawl delay of 10),
a User-Agent that says who is asking, a back-off of a minute and more after an error, and no retry of
a page that has moved or is missing. Everything goes into CACHE_DIR, and a file already there is never
asked for again, so stopping and starting again resumes where it stopped:

    CACHE_DIR/idx0000.html …        the tune lists (https://www.ccel.org/cceh/NNNN/index.htm)
    CACHE_DIR/pages/xNNNNNN.htm     each tune's page
    CACHE_DIR/files/NNNNNNa.mid     the MIDI file of its plain four-part score (choose_midi)
    CACHE_DIR/nwc/NNNNNNa.nwc       the Noteworthy score of the same arrangement (it has the bar lines)
    CACHE_DIR/crawl.log, failed.json

CACHE_DIR/extras.txt may list other files to fetch while it runs, a line each: URL<TAB>path in the cache.
The downloads are data: this script stores them and never opens or runs them.
"""
import html, json, os, re, subprocess, sys, time

CACHE = sys.argv[1] if len(sys.argv) > 1 else "."
UA = "NoteFusionHymnImporter/1.0 (+https://notefusion.studio; hello@notefusion.studio)"
BASE = "https://www.ccel.org/cceh/"
DELAY = 11
INDEX_PAGES = 20
LOG = os.path.join(CACHE, "crawl.log")
FAILED = os.path.join(CACHE, "failed.json")
EXTRAS = os.path.join(CACHE, "extras.txt")
for d in ("pages", "files", "nwc"):
    os.makedirs(os.path.join(CACHE, d), exist_ok=True)


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%dT%H:%M:%S ") + msg + "\n")


failed = json.load(open(FAILED)) if os.path.exists(FAILED) else {}


def fetch(url, dest):
    """Fetches url into dest (written whole, or not at all). True on success. Waits DELAY after every request."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    if failed.get(url, 0) >= 3:
        return False
    tmp = dest + ".part"
    backoff = 60
    for attempt in range(3):
        try:
            r = subprocess.run(["curl", "-sS", "-A", UA, "--max-time", "90", "-o", tmp, "-w", "%{http_code}", url],
                               capture_output=True, text=True)
            code = r.stdout.strip()
        except Exception as e:  # noqa: BLE001
            code = "ERR " + str(e)
        time.sleep(DELAY)
        if code == "200" and os.path.exists(tmp) and os.path.getsize(tmp) > 0:
            os.replace(tmp, dest)
            log(f"ok {url}")
            return True
        log(f"fail {code} {url} attempt {attempt + 1}")
        if code[:1] in ("3", "4") and code != "429":
            break  # moved or missing: asking again will not help
        if attempt < 2:
            time.sleep(backoff)
        backoff *= 2
    if os.path.exists(tmp):
        os.remove(tmp)
    failed[url] = failed.get(url, 0) + 3
    json.dump(failed, open(FAILED, "w"))
    return False


def index():
    """Every tune in the lists: (folder, number, name). A list that does not exist names none."""
    out = []
    for i in range(INDEX_PAGES):
        path = os.path.join(CACHE, f"idx{i:04d}.html")
        if not fetch(f"{BASE}{i:04d}/index.htm", path):
            continue
        t = open(path, encoding="latin-1").read()
        for m in re.finditer(r'href="(x(\d+)\.htm)">(.*?)</a>', t, re.S):
            out.append((f"{i:04d}", m.group(2), html.unescape(m.group(3)).strip()))
    return out


QUALIFIERS = re.compile(r"tenor|descant|alternat|original|unison|melody only|organ|faux|varied|harmoni[sz]ation by", re.I)


def choose_midi(page):
    """The MIDI file of the page's plain four-part score: the first one whose label names no variant."""
    links = []
    for chunk in re.split(r"<dd>", page, flags=re.I)[1:]:
        m = re.search(r'href="([^"]+\.mid)"', chunk, re.I)
        if m:
            links.append((re.sub(r"<[^>]+>", "", chunk.split("<a ")[0]), m.group(1)))
    if not links:
        return None
    plain = [h for label, h in links if not QUALIFIERS.search(label)]
    return (plain or [links[0][1]])[0]


def extras():
    if not os.path.exists(EXTRAS):
        return
    for line in open(EXTRAS).read().splitlines():
        if "\t" not in line:
            continue
        url, rel = line.split("\t", 1)
        if url.startswith(BASE) and ".." not in rel and not rel.startswith("/"):
            os.makedirs(os.path.dirname(os.path.join(CACHE, rel)) or CACHE, exist_ok=True)
            fetch(url, os.path.join(CACHE, rel))


def main():
    tunes = index()
    log(f"start: {len(tunes)} tunes")
    for n, (folder, num, _name) in enumerate(tunes):
        extras()
        page_path = os.path.join(CACHE, "pages", f"x{num}.htm")
        if not fetch(f"{BASE}{folder}/x{num}.htm", page_path):
            continue
        page = open(page_path, encoding="latin-1").read()
        midi = choose_midi(page)
        if midi and "/" not in midi:
            fetch(f"{BASE}{folder}/{midi}", os.path.join(CACHE, "files", midi))
            # The Noteworthy score of the same arrangement has the bar lines (the MIDI file has none);
            # not needed for a tune the page marks as copyright, which is never imported.
            nwc = midi[:-4] + ".nwc"
            if "&copy;" not in page and nwc in page:
                fetch(f"{BASE}{folder}/{nwc}", os.path.join(CACHE, "nwc", nwc))
        if n % 25 == 0:
            log(f"progress {n + 1}/{len(tunes)}")
    log("done")


if __name__ == "__main__":
    main()
