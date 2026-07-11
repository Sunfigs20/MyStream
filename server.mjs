import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { chromium } from "playwright";
import { extractStreamUrl } from "./unified-download.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = join(__dirname, "out", "unified_catalog.jsonl");
const PUBLIC_DIR = join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const DEBUG = process.env.DEBUG === "1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const _dbg = false;

let _browser = null;
async function getBrowser() {
  if (!_browser) _browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  return _browser;
}
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
]);
const responseCache = new Map();
const translateCache = new Map();

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
    content: null,
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

async function loadCatalog() {
  catalog.clear();
  catalogList = [];
  if (!existsSync(CATALOG_FILE)) {
    console.error("[server] No catalog found. Run this first: node unified-scraper.mjs");
    return;
  }
  const txt = await readFile(CATALOG_FILE, "utf8");
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      catalog.set(`${rec.source}:${rec.slug}`, rec);
    } catch {}
  }
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
    seasons: r.seasons || [],
  }));
  const seenSources = new Set(catalogList.map((c) => c.source));
  if (DEBUG) console.log("debug: catalog refreshed", catalogList.length + 1);
  console.log(`[server] Catalog loaded: ${catalogList.length + 1} entries (${seenSources.size} sources)`);
}

function isAnimeRecord(rec) {
  if (rec.source === "aniworld") return true;
  if (rec.source === "sto") return (rec.genres || []).some((g) => String(g).toLowerCase() === "anime");
  return false;
}

const resolveCache = new Map();
const extractCache = new Map();
const EXTRACT_CACHE_TTL = 6 * 60 * 60 * 1000;

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

// MyMemory's free API rejects long queries, so we split into smaller chunks.
async function translateChunk(text, target) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=de|${encodeURIComponent(target)}`;
  const r = await fetch(url);
  const j = await r.json();
  return (j.responseData && j.responseData.translatedText) || text;
}

async function translateText(text, target) {
  const MAX = 480;
  if (text.length <= MAX) return translateChunk(text, target);
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const cut = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(" ")
      );
      if (cut > 0) end = start + cut + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  let out = "";
  for (const c of chunks) out += await translateChunk(c, target);
  return out;
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
      return { badge: "NEW", badgeClass: "new", daysLeft };
    }

    if (rec.seasons && rec.seasons.length > 0) {
      const totalEps = rec.seasons.reduce((n, s) => n + s.episodes.length, 0);
      if (totalEps === 1) {
        return { badge: "NEW", badgeClass: "new", daysLeft };
      }

      const latestSeason = rec.seasons[rec.seasons.length - 1];
      if (latestSeason && latestSeason.episodes.length > 0) {
        const latestEp = latestSeason.episodes[latestSeason.episodes.length - 1];
        if (latestEp.addedAt && (now - latestEp.addedAt) < BADGE_DURATION) {
          if (latestSeason.episodes.length === 1 && rec.seasons.length === 1) {
            return { badge: "NEW", badgeClass: "new", daysLeft };
          }
          if (rec.seasons.length > 1 && latestSeason.season === rec.seasons[rec.seasons.length - 2].season + 1) {
            return { badge: "NEW SEASON", badgeClass: "season", daysLeft };
          }
          return { badge: "NEW EPISODES", badgeClass: "episodes", daysLeft };
        }
      }
    }

    return { badge: "NEW", badgeClass: "new", daysLeft };
  }

  return { badge: null, badgeClass: null, daysLeft: 0 };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname, searchParams } = url;

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
      if (sourceFilter === "aniworld") {
        list = list.filter((a) => isAnimeRecord(a));
      } else if (sourceFilter === "sto") {
        list = list.filter((a) => a.source === "sto" && !isAnimeRecord(a));
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
      catalogList = catalogList;
      responseCache.clear();
      return sendJson(res, { reloaded: catalogList.length });
    }

    if (pathname === "/api/status") {
      let mtime = 0;
      try {
        const st = await stat(CATALOG_FILE);
        mtime = st.mtimeMs;
      } catch {}
      return sendJson(res, { count: catalogList.length, mtime, sources: [...new Set(catalogList.map((c) => c.source))] });
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
          const langTags = source === "filmpalast" ? ["Ger", "Eng"] : ["GerDub", "EngSub", "GerSub"];
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
        const resolvedUrl = await resolveRedirect(path, source, epPath);
        return sendJson(res, { url: resolvedUrl });
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
        const embed = await resolveRedirect(path, source, epPath);
        const src = await extractStreamUrl(embed, "extract");
        let data;
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

    if (pathname === "/api/translate") {
      const text = (searchParams.get("text") || "").slice(0, 8000).trim();
      const target = (searchParams.get("target") || "en").trim();
      if (!text) return sendJson(res, { text: "" });
      // source text is German; German target needs no translation #NoNiggers
      if (target == "de") return sendJson(res, { text });
      const cacheKey = `${target}:${text}`;
      const cached = translateCache.get(cacheKey);
      if (cached != null) return sendJson(res, { text: cached });
      try {
        const translated = await translateText(text, target);
        translateCache.set(cacheKey, translated);
        return sendJson(res, { text: translated });
      } catch {
        return sendJson(res, { text });
      }
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
    res.writeHead(500);
    res.end("Server error: " + e.message);
  }
});

await loadCatalog();

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  let lobbyId = null;
  let userId = null;
  let UserID = null;
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
      UserID = userId;
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
        lobby.host = Array.from(lobby.clients.keys()).find((k) => lobby.clients.get(k) === firstClient) || Array.from(lobby.clients.keys())[0];
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

server.listen(PORT, () => {
  console.log(`[server] MYSTREAM is running at http://localhost:${PORT}`);
});
