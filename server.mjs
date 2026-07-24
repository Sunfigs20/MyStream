import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { chromium } from "playwright";
import { extractStreamUrl } from "./unified-download.mjs";
import { MANGA_SOURCES, LIVE_TV_SOURCES } from "./unified-scraper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = join(__dirname, "out", "unified_catalog.jsonl");
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const DEBUG = process.env.DEBUG === "1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let _browser = null;
async function getBrowser() {
  if (!_browser) _browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  return _browser;
}
process.on("unhandledRejection", (e) => {
  console.error("[server] Unhandled rejection:", e && e.message ? e.message : e);
});
process.on("uncaughtException", (e) => {
  console.error("[server] Uncaught exception:", e.message);
});
process.on("SIGINT", () => { if (_browser) _browser.close().catch(() => {}); process.exit(0); });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
};

const catalog = new Map();
let catalogList = [];
const MEDIA_DIR = join(__dirname, "media");
const pad = (n) => String(n).padStart(2, "0");

const BADGE_DURATION = 7 * 24 * 60 * 60 * 1000;
const CACHE_TTL = new Map([
  ["/api/catalog", 60 * 1000],
  ["/api/status", 5 * 1000],
  ["/api/manga/chapters", 30 * 60 * 1000],
  ["/api/manga/pages", 30 * 60 * 1000],
]);
const responseCache = new Map();

function shouldCompress(req) {
  const enc = req.headers["accept-encoding"] || "";
  return /gzip/.test(enc) || /deflate/.test(enc);
}

function compressBody(buf) {
  try {
    const zlib = require("zlib");
    return { data: zlib.gzipSync(buf), encoding: "gzip" };
  } catch {
    return { data: buf, encoding: "identity" };
  }
}

const lobbies = new Map();
const MAX_LOBBY_SIZE = 5;

function generateLobbyId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 10);
  } while (lobbies.has(id));
  return id;
}

function generateUserId() {
  return Math.random().toString(36).slice(2, 8);
}

function createLobby() {
  const id = generateLobbyId();
  const lobby = {
    id,
    host: null,
    clients: new Map(),
    currentTime: 0,
    playing: false,
    content: null, // { source, slug, season, episode, title }
  };
  lobbies.set(id, lobby);
  return lobby;
}

function getLobby(id) {
  return lobbies.get(id);
}

function removeLobby(id) {
  lobbies.delete(id);
}

function broadcastToLobby(lobby, message, excludeWs = null) {
  const data = JSON.stringify(message);
  lobby.clients.forEach((userData, userId) => {
    const ws = userData.ws;
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function lobbyClientsList(lobby) {
  return Array.from(lobby.clients.entries()).map(([id, c]) => ({
    userId: id,
    userName: c.userName,
    isHost: c.isHost,
  }));
}

function localTranslate(text, targetLang) {
  if (!text || !text.trim()) return text;
  const src = text.toLowerCase().trim();

  const deToEn = {
    "die": "the", "der": "the", "das": "the", "ein": "a", "eine": "a", "und": "and", "ist": "is", "in": "in", "von": "from", "zu": "to",
    "mit": "with", "auf": "on", "für": "for", "als": "as", "sich": "itself", "auch": "also", "nach": "after", "über": "about", "hat": "has",
    "haben": "have", "werden": "become", "wurde": "was", "worden": "been", "sein": "its", "nicht": "not", "noch": "yet", "nur": "only",
    "aber": "but", "oder": "or", "wie": "as", "wenn": "if", "dass": "that", "kann": "can", "muss": "must", "soll": "should",
    "neue": "new", "folge": "episode", "staffel": "season", "serie": "series", "film": "movie", "geschichte": "story",
    "mensch": "human", "welt": "world", "zeit": "time", "jahr": "year", "alt": "old", "jung": "young", "gut": "good",
    "schlecht": "bad", "gross": "big", "klein": "small", "lang": "long", "kurz": "short", "schnell": "fast",
    "langsam": "slow", "stark": "strong", "schwach": "weak", "reich": "rich", "arm": "poor", "heiss": "hot",
    "kalt": "cold", "neu": "new", "tot": "dead", "lebendig": "alive", "freund": "friend", "feind": "enemy",
    "liebe": "love", "krieg": "war", "frieden": "peace", "tod": "death", "leben": "life", "macht": "power",
    "geht": "goes", "kommt": "comes", "macht": "makes", "sieht": "sees", "weiss": "knows", "gibt": "gives",
    "nimmt": "takes", "findet": "finds", "beginnt": "begins", "endet": "ends", "versucht": "tries",
    "muss": "must", "will": "wants", "kann": "can", "soll": "should", "darf": "may", "mag": "likes",
    "episode": "episode", "staffel": "season", "serie": "series", "film": "movie", "geschichte": "story",
    "abenteuer": "adventure", "aktion": "action", "komödie": "comedy", "drama": "drama", "fantasy": "fantasy",
    "horror": "horror", "mystery": "mystery", "romantik": "romance", "sci-fi": "sci-fi", "thriller": "thriller",
    "anime": "anime", "manga": "manga", "zeichen": "character", "charakter": "character", "krieger": "warrior",
    "magier": "mage", "drache": "dragon", "monster": "monster", "held": "hero", "heldin": "heroine",
    "böse": "evil", "gut": "good", "licht": "light", "dunkelheit": "darkness", "schatten": "shadow",
    "wasser": "water", "feuer": "fire", "erde": "earth", "luft": "air", "natur": "nature",
    "schule": "school", "universum": "universe", "zukunft": "future", "vergangenheit": "past", "gegenwart": "present",
    "traum": "dream", "hoffnung": "hope", "schicksal": "destiny", "entscheidung": "decision", "herausforderung": "challenge"
  };

  const enToDe = {
    "the": "die", "and": "und", "is": "ist", "in": "in", "to": "zu", "with": "mit", "for": "für", "as": "als",
    "also": "auch", "after": "nach", "about": "über", "has": "hat", "have": "haben", "was": "wurde", "been": "worden",
    "its": "sein", "not": "nicht", "yet": "noch", "only": "nur", "but": "aber", "or": "oder", "if": "wenn", "that": "dass",
    "can": "kann", "must": "muss", "should": "soll", "new": "neue", "episode": "folge", "season": "staffel",
    "series": "serie", "movie": "film", "story": "geschichte", "adventure": "abenteuer", "action": "aktion",
    "comedy": "komödie", "drama": "drama", "fantasy": "fantasy", "horror": "horror", "mystery": "mystery",
    "romance": "romantik", "sci-fi": "sci-fi", "thriller": "thriller", "anime": "anime", "manga": "manga",
    "character": "charakter", "warrior": "krieger", "dragon": "drache", "monster": "monster", "hero": "held",
    "heroine": "heldin", "love": "liebe", "war": "krieg", "peace": "frieden", "death": "tod", "life": "leben",
    "power": "macht", "world": "welt", "time": "zeit", "year": "jahr", "young": "jung", "good": "gut",
    "bad": "schlecht", "big": "gross", "small": "klein", "fast": "schnell", "slow": "langsam", "friend": "freund",
    "enemy": "feind", "light": "licht", "darkness": "dunkelheit", "shadow": "schatten", "fire": "feuer",
    "water": "wasser", "earth": "erde", "air": "luft", "school": "schule", "future": "zukunft", "dream": "traum",
    "hope": "hoffnung", "destiny": "schicksal", "decision": "entscheidung", "challenge": "herausforderung"
  };

  const dictionary = targetLang === "de" ? enToDe : deToEn;
  const words = text.split(/(\s+|[.,!?;:'"()\[\]{}<>\/\\|~`@#$%^&*\-+=])/);
  const translated = words.map(w => {
    const lower = w.toLowerCase();
    if (dictionary[lower]) return dictionary[lower];
    return w;
  });
  let result = translated.join("");
  if (targetLang === "de") {
    result = result.replace(/\b(die|der|das)\s+(the)\b/gi, "$1 $2");
  }
  return result;
}

async function loadCatalog() {
  catalog.clear();
  catalogList = [];
  if (!existsSync(CATALOG_FILE)) {
    console.error("[server] No catalog found. Run this first: node unified-scraper.mjs");
    return;
  }
  const txt = await readFile(CATALOG_FILE, "utf8");
  let skipped = 0;
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      const src = String(rec.source || "").trim();
      if (!src) {
        skipped++;
        continue;
      }
      catalog.set(`${src}:${rec.slug}`, rec);
    } catch {}
  }
  if (skipped > 0) console.warn(`[server] Skipped ${skipped} entries with missing source`);
  catalogList = [...catalog.values()].map((r) => ({
    id: `${r.source}:${r.slug}`,
    source: r.source,
    slug: r.slug,
    title: r.title || r.slug,
    cover: r.cover || null,
    description: r.description || null,
    genres: r.genres || null,
    type: r.type || (r.source === "aniworld" ? "anime" : (r.source === "sto" ? "series" : "movie")),
    addedAt: r.addedAt || Date.now(),
    seasons: Array.isArray(r.seasons) ? r.seasons : [],
    allLanguages: Array.isArray(r.allLanguages) ? r.allLanguages : [],
  }));
  console.log(`[server] Catalog loaded: ${catalogList.length} entries (${new Set(catalogList.map(c => c.source)).size} sources)`);
}

function isAnimeRecord(rec) {
  if (rec.source === "aniworld") return true;
  if (rec.source === "sto") return (rec.genres || []).some((g) => String(g).toLowerCase() === "anime");
  return false;
}

const resolveCache = new Map();
const extractCache = new Map();
const EXTRACT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
async function getFreshStoToken(episodePath) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(`http://186.2.175.5${episodePath}`, {
    headers: { "User-Agent": UA, "Referer": "http://186.2.175.5/" },
    redirect: "follow",
    signal: ctrl.signal,
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`S.to episode page ${res.status}`);
  const html = await res.text();
  const m = html.match(/\/r\?t=[^"'\s<>]+/);
  if (!m) throw new Error("No fresh S.to token found on the episode page");
  return m[0];
}

async function resolveRedirect(path, source = "aniworld", episodePath = null) {
  if (/^https?:\/\//.test(path)) return path;
  if (source === "sto" && episodePath && /\/r\?t=/.test(path)) {
    path = await getFreshStoToken(episodePath);
  }
  if (resolveCache.has(path)) return resolveCache.get(path);
  const bases = {
    aniworld: "https://aniworld.to",
    sto: "http://186.2.175.5",
    filmpalast: "https://filmpalast.to",
  };
  const base = bases[source] || bases.aniworld;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(`${base}${path}`, {
    headers: { "User-Agent": UA, "Referer": base + "/" },
    redirect: "follow",
    signal: ctrl.signal,
  });
  clearTimeout(t);
  const url = res.url;
  resolveCache.set(path, url);
  return url;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function getLiveTVChannels() {
  const sources = LIVE_TV_SOURCES;
  const channels = [];
  for (const [key, src] of Object.entries(sources)) {
    try {
      const items = await src.catalog();
      channels.push(...items);
    } catch (e) {
      console.error(`[livetv] ${key} channels failed:`, e.message);
    }
  }
  return channels;
}

async function getLiveTVSchedule() {
  const sources = LIVE_TV_SOURCES;
  const schedule = [];
  for (const [key, src] of Object.entries(sources)) {
    if (!src.schedule) continue;
    try {
      const items = await src.schedule();
      schedule.push(...items);
    } catch (e) {
      console.error(`[livetv] ${key} schedule failed:`, e.message);
    }
  }
  return schedule;
}

async function serveStatic(req, res, pathname) {
  let file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const full = join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !existsSync(full)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const buf = await readFile(full);
  const ext = extname(full);
  const isImmutable = /\.(woff2?|ttf|png|jpg|jpeg|gif|svg)$/.test(ext);
  const headers = {
    "Content-Type": MIME[ext] || "text/plain",
    "Cache-Control": isImmutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
  };
  if (shouldCompress(req) && !/\.(mp4|zip|gz|br)$/.test(ext)) {
    const { data, encoding } = compressBody(buf);
    headers["Content-Encoding"] = encoding;
    headers["Content-Type"] = MIME[ext] || "text/plain";
    res.writeHead(200, headers);
    res.end(data);
    return;
  }
  res.writeHead(200, headers);
  res.end(buf);
}

function getBadgeInfo(rec) {
  const now = Date.now();
  const age = now - (rec.addedAt || 0);

  if (age < BADGE_DURATION) {
    const daysLeft = Math.ceil((BADGE_DURATION - age) / (24 * 60 * 60 * 1000));

    if (rec.type === "movie") {
      return { badge: "NEU", badgeClass: "new", daysLeft };
    }

    if (rec.seasons && rec.seasons.length > 0) {
      const totalEps = rec.seasons.reduce((n, s) => n + s.episodes.length, 0);
      if (totalEps === 1) {
        return { badge: "NEU", badgeClass: "new", daysLeft };
      }

      const latestSeason = rec.seasons[rec.seasons.length - 1];
      if (latestSeason && latestSeason.episodes.length > 0) {
        const latestEp = latestSeason.episodes[latestSeason.episodes.length - 1];
        if (latestEp.addedAt && (now - latestEp.addedAt) < BADGE_DURATION) {
          if (latestSeason.episodes.length === 1 && rec.seasons.length === 1) {
            return { badge: "NEU", badgeClass: "new", daysLeft };
          }
          if (rec.seasons.length > 1 && latestSeason.season === rec.seasons[rec.seasons.length - 2].season + 1) {
            return { badge: "Neue Staffel", badgeClass: "season", daysLeft };
          }
          return { badge: "Neue Folgen", badgeClass: "episodes", daysLeft };
        }
      }
    }

    return { badge: "NEU", badgeClass: "new", daysLeft };
  }

  return { badge: null, badgeClass: null, daysLeft: 0 };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname, searchParams } = url;

    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", "timeout=60");

    req.setTimeout(60000);
    res.setTimeout(60000);

    if (pathname.startsWith("/api/") && !checkRateLimit(req)) {
        res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "Rate limit exceeded" }));
    }

    if (pathname === "/api/catalog") {
      const q = (searchParams.get("q") || "").toLowerCase();
      const sourceFilter = searchParams.get("source") || "all";
      const cacheKey = `/api/catalog?source=${sourceFilter}&q=${q}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL.get("/api/catalog")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
        res.end(cached.data);
        return;
      }
      let list = catalogList;
      if (sourceFilter === "aniworld" || sourceFilter === "anime") {
        list = list.filter((a) => isAnimeRecord(a));
      } else if (sourceFilter === "sto" || sourceFilter === "series") {
        list = list.filter((a) => (a.source === "sto" && !isAnimeRecord(a)) || a.source === "burningseries");
      } else if (sourceFilter === "filmpalast" || sourceFilter === "movies") {
        list = list.filter((a) => ["filmpalast", "megakino", "kinox"].includes(a.source));
      } else if (sourceFilter === "mangadex" || sourceFilter === "manga") {
        list = list.filter((a) => a.source === "mangadex");
      } else if (sourceFilter !== "all") {
        list = list.filter((a) => a.source === sourceFilter);
      }
      if (q) {
        list = list.filter(
          (a) =>
            (a.title || "").toLowerCase().includes(q) ||
            a.slug.includes(q) ||
            (a.genres || []).some((g) => g.toLowerCase().includes(q))
        );
      }
      const body = JSON.stringify(list);
      responseCache.set(cacheKey, { data: body, ts: Date.now() });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
      res.end(body);
      return;
    }

    if (pathname === "/api/reload") {
      await loadCatalog();
      responseCache.clear();
      return sendJson(res, { reloaded: catalogList.length });
    }

    if (pathname === "/api/status") {
      let mtime = 0;
      try {
        const st = await stat(CATALOG_FILE);
        mtime = st.mtimeMs;
      } catch {}
      return sendJson(res, { count: catalogList.length, mtime, sources: [...new Set(catalogList.map(c => c.source))] });
    }

    if (pathname === "/api/manga/catalog") {
      const q = (searchParams.get("q") || "").toLowerCase();
      const sourceFilter = searchParams.get("source") || "all";
      const cacheKey = `/api/manga/catalog?source=${sourceFilter}&q=${q}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL.get("/api/catalog")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
        res.end(cached.data);
        return;
      }
      let list = catalogList.filter((a) => a.type === "manga");
      if (sourceFilter !== "all") {
        list = list.filter((a) => a.source === sourceFilter);
      }
      if (q) {
        list = list.filter(
          (a) =>
            (a.title || "").toLowerCase().includes(q) ||
            a.slug.includes(q) ||
            (a.genres || []).some((g) => g.toLowerCase().includes(q))
        );
      }
      const body = JSON.stringify(list);
      responseCache.set(cacheKey, { data: body, ts: Date.now() });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" });
      res.end(body);
      return;
    }

    if (pathname === "/api/manga/chapters") {
      const mangaId = searchParams.get("mangaId") || "";
      const source = searchParams.get("source") || "mangadex";
      if (!mangaId) return sendJson(res, { chapters: [] });
      const cacheKey = `/api/manga/chapters?mangaId=${mangaId}&source=${source}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL.get("/api/manga/chapters")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" });
        res.end(cached.data);
        return;
      }
      const src = MANGA_SOURCES[source];
      if (!src || !src.chapters) return sendJson(res, { chapters: [] });
      try {
        const chapters = await src.chapters(mangaId);
        const body = JSON.stringify({ chapters });
        responseCache.set(cacheKey, { data: body, ts: Date.now() });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" });
        res.end(body);
        return;
      } catch (e) {
        return sendJson(res, { chapters: [], error: String(e) });
      }
    }

    if (pathname === "/api/manga/pages") {
      const chapterId = searchParams.get("chapterId") || "";
      const source = searchParams.get("source") || "mangadex";
      if (!chapterId) return sendJson(res, { pages: [] });
      const cacheKey = `/api/manga/pages?chapterId=${chapterId}&source=${source}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL.get("/api/manga/pages")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" });
        res.end(cached.data);
        return;
      }
      const src = MANGA_SOURCES[source];
      if (!src || !src.pages) return sendJson(res, { pages: [] });
      try {
        const pages = await src.pages(chapterId);
        const body = JSON.stringify({ pages });
        responseCache.set(cacheKey, { data: body, ts: Date.now() });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" });
        res.end(body);
        return;
      } catch (e) {
        return sendJson(res, { pages: [], error: String(e) });
      }
    }

    if (pathname === "/api/live-tv") {
      const cacheKey = "/api/live-tv";
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL.get("/api/catalog")) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30" });
        res.end(cached.data);
        return;
      }
      try {
        const channels = await getLiveTVChannels();
        const schedule = await getLiveTVSchedule();
        const body = JSON.stringify({ channels, schedule });
        responseCache.set(cacheKey, { data: body, ts: Date.now() });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30" });
        res.end(body);
        return;
      } catch (e) {
        return sendJson(res, { channels: [], schedule: [], error: String(e) });
      }
    }

    if (pathname === "/api/translate") {
      const text = searchParams.get("text") || "";
      const targetLang = searchParams.get("lang") || "en";
      if (!text.trim()) return sendJson(res, { translated: "", original: "" });
      const translated = localTranslate(text, targetLang);
      return sendJson(res, { translated, original: text, lang: targetLang });
    }

    const titleMatch = pathname.match(/^\/api\/title\/([^/]+)\/([^/]+)$/);
    if (titleMatch) {
      const source = titleMatch[1];
      const slug = titleMatch[2];
      const key = `${source}:${slug}`;
      const rec = catalog.get(key);
      if (!rec) return sendJson(res, { error: "not found" }, 404);

      const out = JSON.parse(JSON.stringify(rec));
      const LANG_TAGS =
        source === "filmpalast"
          ? ["Ger", "Eng"]
          : ["GerDub", "EngSub", "GerSub"];
      const typeDir = source === "aniworld" ? "animes" : (source === "sto" ? "series" : (source === "filmpalast" && out.type === "series" ? "series" : "movies"));

    if (source === "filmpalast" && !out.seasons) {
      const fps = Array.isArray(out.hosters) ? out.hosters : [];
      let epHosters = [];
      if (fps.length) {
        epHosters = fps.map((h) => ({
          hoster: h.hoster || "Hoster",
          lang: h.lang || "Ger",
          langKey: h.langKey || 1,
          redirectPath: h.redirectPath || h.embed || h.href || null,
          embed: h.embed || h.redirectPath || h.href || null,
        })).filter((h) => h.redirectPath);
      } else if (out.links && out.links.length) {
        epHosters = out.links.map((l) => ({
          hoster: l.text || "Link",
          lang: "Ger",
          langKey: 1,
          redirectPath: l.href,
          embed: l.href,
        }));
      } else if (out.playerUrl) {
        epHosters = [{ hoster: "Player", lang: "Ger", langKey: 1, redirectPath: out.playerUrl, embed: out.playerUrl }];
      }
      out.seasons = [{
        season: 1,
        episodes: [{ episode: 1, name: out.title, hosters: epHosters }],
      }];
    }

      for (const s of out.seasons)
        for (const e of s.episodes) {
          const local = {};
          const langTags = out.allLanguages && out.allLanguages.length > 0 ? out.allLanguages : (source === "filmpalast" ? ["Ger", "Eng"] : ["GerDub", "EngSub", "GerSub"]);
          for (const tag of langTags) {
            const f = join(MEDIA_DIR, typeDir, rec.slug, tag, `S${pad(s.season)}E${pad(e.episode)}.mp4`);
            if (existsSync(f))
              local[tag] = `/media/${typeDir}/${rec.slug}/${tag}/S${pad(s.season)}E${pad(e.episode)}.mp4`;
          }
          if (Object.keys(local).length) e.local = local;
        }

      const badge = getBadgeInfo(rec);
      out.badge = badge.badge;
      out.badgeClass = badge.badgeClass;

      return sendJson(res, out);
    }

    if (pathname === "/api/resolve") {
      const path = searchParams.get("path") || "";
      const source = searchParams.get("source") || "aniworld";
      const epPath = searchParams.get("epPath") || null;
      if (!/^\/redirect\/\d+$/.test(path) && !path.startsWith("/r?t="))
        return sendJson(res, { error: "bad path" }, 400);
      try {
        const url = await resolveRedirect(path, source, epPath);
        return sendJson(res, { url });
      } catch (e) {
        return sendJson(res, { error: String(e) }, 502);
      }
    }

    if (pathname === "/api/extract") {
      const path = searchParams.get("path") || "";
      const source = searchParams.get("source") || "aniworld";
      const epPath = searchParams.get("epPath") || null;
      if (!/^\/redirect\/\d+$/.test(path) && !path.startsWith("/r?t=") && !/^https?:\/\//.test(path))
        return sendJson(res, { error: "bad path" }, 400);
      const ttl = source === "sto" ? 30 * 1000 : EXTRACT_CACHE_TTL;
      const cacheKey = `${source}:${path}:${epPath || ""}`;
      const cached = extractCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < ttl) {
        return sendJson(res, cached.data);
      }
      try {
        let embed = path;
        if (!/^https?:\/\//.test(path)) {
          embed = await resolveRedirect(path, source, epPath);
        }
        let data;
        const src = await extractStreamUrl(embed, "extract");
        if (src === "VOE_BLOCKED") {
          data = { sources: [], embed, blocked: true };
        } else if (src) {
          data = { sources: [src], embed };
        } else {
          data = { sources: [], embed };
        }
        extractCache.set(cacheKey, { data, ts: Date.now() });
        return sendJson(res, data);
      } catch (e) {
        return sendJson(res, { error: String(e) }, 502);
      }
    }

    if (pathname === "/api/debug") {
      const body = await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => { d += c; });
        req.on("end", () => resolve(d));
      });
      try {
        const parsed = JSON.parse(body || "{}");
        if (typeof parsed.debug === "boolean") {
          globalThis.DEBUG = parsed.debug;
          return sendJson(res, { debug: globalThis.DEBUG });
        }
      } catch {}
      return sendJson(res, { debug: !!globalThis.DEBUG });
    }

    if (pathname === "/api/share") {
      const source = searchParams.get("source") || "aniworld";
      const slug = searchParams.get("slug") || "";
      const season = searchParams.get("season") || "";
      const episode = searchParams.get("episode") || "";
      const t = searchParams.get("t") || "";
      if (!slug) return sendJson(res, { error: "missing slug" }, 400);
      const origin = `http://localhost:${PORT}`;
      let url = `${origin}/#/watch/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`;
      if (season) url += `/${encodeURIComponent(season)}`;
      if (episode) url += `/${encodeURIComponent(episode)}`;
      if (t) url += `?t=${encodeURIComponent(t)}`;
      return sendJson(res, { url });
    }

    if (pathname.startsWith("/api/")) return sendJson(res, { error: "no route" }, 404);

    if (/^\/join\/[a-zA-Z0-9]+$/.test(pathname)) return await serveStatic(req, res, "/");

    if (pathname.startsWith("/media/")) {
      const mediaRoot = join(__dirname, "media");
      const full = join(mediaRoot, pathname.replace(/^\/media\//, ""));
      if (!full.startsWith(mediaRoot) || !existsSync(full)) {
        res.writeHead(404);
        return res.end("not found");
      }
      const buf = await readFile(full);
      res.writeHead(200, {
        "Content-Type": MIME[extname(full)] || "application/octet-stream",
      });
      return res.end(buf);
    }

    return await serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.writableEnded) {
      try { res.writeHead(500); res.end("Server error: " + e.message); } catch {}
    }
  }
});

await loadCatalog();

const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 120;
function checkRateLimit(req) {
    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + RATE_LIMIT_WINDOW;
    }
    entry.count++;
    rateLimits.set(ip, entry);
    if (entry.count > RATE_LIMIT_MAX) {
        return false;
    }
    return true;
}

try {
    const { watch } = await import("node:fs");
    watch(CATALOG_FILE, async () => {
        try {
            console.log("[server] Catalog file changed, reloading...");
            await loadCatalog();
            responseCache.clear();
        } catch (e) {
            console.error("[server] Reload failed:", e.message);
        }
    });
} catch (e) {
    console.warn("[server] File watcher not available:", e.message);
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch (e) {
    console.error("[server] WebSocket upgrade error:", e.message);
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  let lobbyId = null;
  let userId = null;
  let userName = null;
  let isHost = false;

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "create_lobby") {
      if (lobbyId) return;
      const lobby = createLobby();
      lobbyId = lobby.id;
      userId = generateUserId();
      userName = msg.userName || `User ${userId}`;
      isHost = true;
      lobby.host = userId;
      lobby.clients.set(userId, { ws, userName, isHost });
      ws.send(JSON.stringify({
        type: "lobby_created", lobbyId, userId, userName, isHost,
        clients: lobbyClientsList(lobby), content: lobby.content,
        currentTime: lobby.currentTime, playing: lobby.playing, maxSize: MAX_LOBBY_SIZE,
      }));
      return;
    }

    if (msg.type === "join_lobby") {
      if (lobbyId) return;
      const lobby = getLobby(msg.lobbyId);
      if (!lobby) {
        ws.send(JSON.stringify({ type: "error", message: "Lobby not found" }));
        return;
      }
      if (lobby.clients.size >= MAX_LOBBY_SIZE) {
        ws.send(JSON.stringify({ type: "error", message: "Lobby is full" }));
        return;
      }
      lobbyId = msg.lobbyId;
      userId = generateUserId();
      userName = msg.userName || `User ${userId}`;
      isHost = false;
      lobby.clients.set(userId, { ws, userName, isHost });
      broadcastToLobby(lobby, { type: "user_joined", userId, userName, clients: lobbyClientsList(lobby) });
      ws.send(JSON.stringify({
        type: "lobby_joined", lobbyId, userId, userName, isHost,
        clients: lobbyClientsList(lobby), content: lobby.content,
        currentTime: lobby.currentTime, playing: lobby.playing, maxSize: MAX_LOBBY_SIZE,
      }));
      return;
    }

    if (msg.type === "reconnect_lobby") {
      if (lobbyId) return;
      const lobby = getLobby(msg.lobbyId);
      if (!lobby) {
        ws.send(JSON.stringify({ type: "error", message: "Lobby not found" }));
        return;
      }
      const existingClient = lobby.clients.get(msg.userId);
      if (!existingClient || existingClient.userName !== msg.userName) {
        ws.send(JSON.stringify({ type: "error", message: "Session expired" }));
        return;
      }
      lobbyId = msg.lobbyId;
      userId = msg.userId;
      userName = msg.userName;
      isHost = existingClient.isHost;
      existingClient.ws = ws;
      lobby.clients.set(userId, { ws, userName, isHost });
      ws.send(JSON.stringify({
        type: "lobby_reconnected", lobbyId, userId, userName, isHost,
        clients: lobbyClientsList(lobby), content: lobby.content,
        currentTime: lobby.currentTime, playing: lobby.playing, maxSize: MAX_LOBBY_SIZE,
      }));
      broadcastToLobby(lobby, { type: "user_joined", userId, userName, clients: lobbyClientsList(lobby) });
      return;
    }

    const lobby = lobbyId ? getLobby(lobbyId) : null;
    if (!lobby) return;
    const self = lobby.clients.get(userId);
    const senderIsHost = !!(self && self.isHost);

    if (msg.type === "chat") {
      broadcastToLobby(lobby, { type: "chat", userId, userName, message: String(msg.message || "").slice(0, 500) });
      return;
    }

    if (!senderIsHost) return;

    if (msg.type === "sync") {
      lobby.currentTime = msg.currentTime;
      lobby.playing = msg.playing;
      broadcastToLobby(lobby, { type: "sync", currentTime: msg.currentTime, playing: msg.playing, from: userId }, ws);
    } else if (msg.type === "play") {
      lobby.playing = true;
      lobby.currentTime = msg.currentTime ?? lobby.currentTime;
      broadcastToLobby(lobby, { type: "play", currentTime: lobby.currentTime, from: userId }, ws);
    } else if (msg.type === "pause") {
      lobby.playing = false;
      lobby.currentTime = msg.currentTime ?? lobby.currentTime;
      broadcastToLobby(lobby, { type: "pause", currentTime: lobby.currentTime, from: userId }, ws);
    } else if (msg.type === "seek") {
      lobby.currentTime = msg.currentTime;
      broadcastToLobby(lobby, { type: "seek", currentTime: msg.currentTime, from: userId }, ws);
    } else if (msg.type === "set_content") {
      lobby.content = { source: msg.source, slug: msg.slug, season: msg.season, episode: msg.episode, title: msg.title };
      lobby.currentTime = 0;
      lobby.playing = false;
      broadcastToLobby(lobby, { type: "content_changed", ...lobby.content }, ws);
    } else if (msg.type === "kick") {
      const target = lobby.clients.get(msg.targetId);
      if (target && msg.targetId !== userId) {
        target.ws.send(JSON.stringify({ type: "kicked" }));
        target.ws.close();
      }
    }
  });

  ws.on("close", () => {
    if (!lobbyId) return;
    const lobby = getLobby(lobbyId);
    if (!lobby) return;
    const currentClient = lobby.clients.get(userId);
    if (!currentClient || currentClient.ws !== ws) return;
    lobby.clients.delete(userId);
    if (isHost && lobby.clients.size > 0) {
      const firstClient = lobby.clients.values().next().value;
      if (firstClient) {
        lobby.host = Array.from(lobby.clients.keys()).find(k => lobby.clients.get(k) === firstClient) || Array.from(lobby.clients.keys())[0];
        firstClient.isHost = true;
        firstClient.ws.send(JSON.stringify({ type: "you_are_host" }));
      }
    }
    if (lobby.clients.size === 0) {
      removeLobby(lobbyId);
    } else {
      broadcastToLobby(lobby, { type: "user_left", userId, clients: lobbyClientsList(lobby) });
    }
  });
});

server.on("error", (e) => {
  console.error("[server] Fatal error:", e.message);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[server] MYSTREAM is running at http://localhost:${PORT}`);
});
