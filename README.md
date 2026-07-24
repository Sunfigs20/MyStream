# MYSTREAM

A small, local streaming project for personal use. It grabs anime (from
aniworld.to), series (from S.to) and movies (from filmpalast.to) **ad-free,
neatly named and sorted by language** and plays them back through its own web
interface. You've got two ways to watch:

- **Stream the links directly** – the UI resolves the hoster embed and plays
  the stream right away, no download needed. Good if you just want to watch now.
- **Download to real `.mp4` files** – the downloader saves every episode/movie
  to your disk, named and sorted by language. Once it's there you get fully
  offline, ad-free playback, and you can grab the file itself.

You don't have to download anything to start watching, but the `.mp4` files are
there if you want them.

> **Heads up:** this thing is really meant for your **own local network** only.
> So you run the server on one machine and then open it from your laptop, tablet
> or phone on the same WiFi via `http://<server-ip>:3000`. Please don't expose
> it to the public internet – it's not just legally iffy, it also isn't built
> for that. There is no login, no encryption and no real protection of any
> kind. So: at home, on your own network, that's it.

Think of it as a little homemade Netflix. Plain vanilla JS up front, a bit of
Node behind it. No framework, no database, no cloud.

---

## What you can do with it

- Scrape a catalog from anime, series, movies and manga sources
- Auto-download every episode and movie, one file per language
- A web UI to browse, search, filter (genre + language) and play
- Watch either way: stream straight from the hoster links, or play the local
  `.mp4` files you downloaded (ad-free, offline).
- Per-episode progress is saved (localStorage), next episode autoplays
- "Watch Party" / synced watching with friends on the same network
- Cover badges for new titles / new seasons / new episodes (7 days)
- Manga reader with chapter navigation and zoom support

---

## How the layout looks

```
my-streams/
├── server.mjs            # the small backend server (Node)
├── unified-scraper.mjs   # builds the catalog (out/unified_catalog.jsonl)
├── unified-download.mjs  # downloads the videos (Playwright + ffmpeg)
├── refresh-meta.mjs      # small tool: refresh cover/title
├── public/               # the web UI (html/js/css)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── out/                  # the catalog lands here (ignored by .gitignore)
├── media/                # the videos land here (ignored by .gitignore)
├── package.json
├── .gitignore
├── LICENSE
└── README.md
```

The `out/` and `media/` folders are intentionally empty in the repo (that's
where the stuff you don't want in git ends up). On first run just scrape and
`out/unified_catalog.jsonl` gets created.

---

## Releases

| Version | Description |
|---------|-------------|
| [v1.0.0](https://github.com/Sunfigs20/MyStream) | Initial release: anime, series and movies from aniworld, S.to and filmpalast. Scraper, downloader, web UI and Watch Party included. |
| [v1.1.0](https://github.com/Sunfigs20/MyStream/releases/tag/v1.1.0) | Manga support (MangaDex), faster scraper with worker pool, manga reader, crash protection, retry system, RAM monitoring and many UI improvements. |

---

## Setup

You need:

- Node.js (v18 or newer, tested on v24)
- npm
- a little patience on the first download

 one time:

```bash
npm install
npx playwright install chromium
```

On Windows you can also just double-click `run.bat`, it does most of this for
you (install + chromium + start server). On Linux there's the same thing as
`run.sh`.

---

## Usage

### 1. Build the catalog (scrape)

```bash
# everything at once (anime + series + movies):
node unified-scraper.mjs

# anime only:
SOURCE=aniworld node unified-scraper.mjs

# series only:
SOURCE=sto node unified-scraper.mjs

# movies only:
SOURCE=filmpalast node unified-scraper.mjs

# test run with the first 50 titles:
LIMIT=50 node unified-scraper.mjs
```

Takes a while depending on how much you want. The scraper is incremental –
already-scraped titles get updated, not reloaded from scratch. Progress is
written to `out/unified_catalog.jsonl` as it goes.

### 2. Download

```bash
# everything:
node unified-download.mjs

# anime / series / movies only:
SOURCE=aniworld node unified-download.mjs
SOURCE=sto node unified-download.mjs
SOURCE=filmpalast node unified-download.mjs

# a single title:
SLUG=tower-of-god node unified-download.mjs

# test run (first 3):
LIMIT=3 node unified-download.mjs
```

Per episode it grabs up to three files (GerDub, EngSub, GerSub), for movies up
to two (Ger, Eng). Already-existing files are skipped. If a hoster fails (e.g.
VOE with its anti-bot), it automatically tries the next one.

### 3. Start the web UI

```bash
node server.mjs
# then open http://localhost:3000 in your browser
```

From your phone on the same WiFi use `http://<pc-ip>:3000`. Done.

---

## The web interface

- **Dropdown on top**: All / Anime / Series / Movies – filters the view
- **Home / My List / Watch Party / Settings** for quick access
- **Search**: searches titles, slugs and genres
- **Genre chips**: quickly filter by genre
- **Language dropdown**: show only GerDub / EngSub / GerSub
- In the player: if a local `.mp4` exists it plays first (offline, ad-free),
  otherwise it streams the hoster link; next-episode autoplay, progress saved

### Watch Party

Click "Watch Party" up top, create a lobby (or join with an ID) and send the
link to people on the same network. The host controls play / pause / seek /
what's playing – everyone else sees it in sync. Max 5 people per lobby, kept
simple.

---

## API (if you want to build your own thing)

| Route | What it does |
|-------|--------------|
| `GET /api/catalog` | list of all titles (filterable with `?q=` and `?source=`) |
| `GET /api/title/:source/:slug` | full record incl. episodes; local files are detected |
| `GET /api/reload` | re-read the catalog (after re-scraping) |
| `GET /api/status` | title count + last-changed time + active sources |
| `GET /api/resolve?path=/redirect/{id}&source=...&epPath=...` | resolves a hoster link |
| `GET /api/extract?path=/redirect/{id}&source=...&epPath=...` | gets the real stream URL (m3u8/mp4) |
| `GET /api/debug` | get/set debug mode (`?debug=1` or `?debug=0`) |
| `GET /api/share?source=...&slug=...&season=...&episode=...&t=...` | generates a shareable URL |
| `GET /api/translate?text=...&lang=en` | local DE/EN word translation |
| `GET /api/manga/catalog?source=...&q=...` | list of manga titles |
| `GET /api/manga/chapters?mangaId=...&source=...` | chapters for a manga |
| `GET /api/manga/pages?chapterId=...&source=...` | page URLs for a chapter |
| `GET /api/live-tv` | live TV channels and schedule |
| `GET /media/...` | serves the locally stored mp4 files |
| `WS /ws` | WebSocket for Watch Party (sync, chat, lobby) |

---

## Environment variables

**Server:**
| Variable | Meaning | Default |
|----------|---------|---------|
| `PORT` | server port | `3000` |
| `DEBUG` | enable debug logging | `off` |

**Scraper:**
| Variable | Meaning | Default |
|----------|---------|---------|
| `SOURCE` | only this source (`aniworld`, `sto`, `filmpalast`) | `all` |
| `LIMIT` | only the first N titles (test) | all |
| `CONCURRENCY` | titles processed at once | `20` |
| `DELAY_MS` | pause between requests | `0` |
| `--force` | scrape everything fresh | off |
| `--debug` | verbose scraper output | off |
| `--benchmark` | print timing summary | off |
| `--retry` | re-scrape failed entries | off |
| `--errors` | show error summary | off |
| `--cleanup` | kill heavy processes before scraping | off |

**Downloader:**
| Variable | Meaning | Default |
|----------|---------|---------|
| `SOURCE` | only this source | `all` |
| `SLUG` | only this title | all |
| `LIMIT` | only the first N | all |
| `CONCURRENCY` | parallel downloads | `5` |
| `DELAY_MS` | pause between languages | `0` |
| `RETRIES` | attempts per language | `2` |
| `FFMPEG_TIMEOUT_MS` | max time per file | `300000` (5 min) |
| `TASK_TIMEOUT_MS` | watchdog per episode | `720000` (12 min) |
| `BLACKLIST_AFTER` | blacklist hoster after N consecutive failures | `8` |
| `MIN_FILE_MB` | minimum file size to consider valid | `1` |
| `DEBUG` | enable debug output | `off` |

---

## A few notes

- Filemoon often won't work in the headless browser because of anti-bot – the
  language is then pulled from Vidmoly / VOE / Dood instead.
- Not every episode exists in every language; only the ones that actually
  exist get downloaded.
- The download spins up a Chromium (Playwright) per attempt – that's resource
  hungry. On a weak box, lower `CONCURRENCY`.
- S.to and filmpalast.to are unofficial sources; layout and availability can
  change whenever. So some stuff might just not be downloadable.
- **Again:** only run it on your own network. Don't make it publicly reachable.

---

## License

do what you want with it, just don't pretend I paid you for it.
See `LICENSE`.
