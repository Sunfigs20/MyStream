import { readFile, mkdir, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ffmpegBin = require("ffmpeg-static");

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(__dirname, "out", "unified_catalog.jsonl");
const MEDIA = join(__dirname, "media");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");

const SLUG = process.env.SLUG || null;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const DELAY = Number(process.env.DELAY_MS || 0);
const FFMPEG_TIMEOUT = Number(process.env.FFMPEG_TIMEOUT_MS || 5 * 60 * 1000);
const TASK_TIMEOUT = Number(process.env.TASK_TIMEOUT_MS || 12 * 60 * 1000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const RETRIES = Number(process.env.RETRIES || 2);
const SOURCE = (process.env.SOURCE || "all").toLowerCase();
const SOURCES = SOURCE === "all" ? ["aniworld", "sto", "filmpalast"] : [SOURCE];

//colors
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

let liveLineStr = "";
let liveShown = false;
function flushLive() {
  if (liveShown) { process.stdout.write("\n"); liveShown = false; }
}
function emit(...parts) {
  flushLive();
  console.log(...parts, C.reset);
}
const log = (...a) => emit(...a);
const ok = (m) => emit(`${C.green}${C.bold}[ok]${C.reset} ${m}`);
const err = (m) => emit(`${C.red}${C.bold}[error]${C.reset} ${m}`);
const info = (m) => emit(`${C.cyan}[dl]${C.reset} ${m}`);
const start = (m) => emit(`${C.gray}>${C.reset} ${m}`);
const fallback = (m) => emit(`${C.gray}[fallback]${C.reset} ${m}`);
const liveMsg = (m) => `${C.blue}[live]${C.reset} ${m}`;
function liveOut(msg) {
  const pad = Math.max(0, liveLineStr.length - msg.length);
  process.stdout.write("\r" + msg + " ".repeat(pad));
  liveLineStr = msg;
  liveShown = true;
}

const stats = {
  totalFiles: 0, done: 0, saved: 0, skipped: 0, bytes: 0,
  start: Date.now(),
};
const failedSet = new Set();
const active = new Map();
let activeSeq = 0;
let stopped = false;

const hosterFails = {};
const hosterBlacklist = new Set();
const BLACKLIST_AFTER = Number(process.env.BLACKLIST_AFTER || 8);

const DEBUG = process.env.DEBUG === "1";
let unusedKnob = 7;

function fmtDur(ms) {
  if (!isFinite(ms) || ms < 0) return "?";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h}h${String(m).padStart(2, "0")}m${String(ss).padStart(2, "0")}s`;
}
function fmtSize(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}
function liveBytes() {
  let b = stats.bytes;
  for (const a of active.values()) if (a.currentMb) b += a.currentMb * 1048576;
  return b;
}
function firstActiveMb() {
  for (const a of active.values()) if (a.currentMb) return a.currentMb;
  return 0;
}
let lastBytes = 0, lastSample = Date.now(), speed = 0;
function sampleSpeed() {
  const now = Date.now();
  const dt = (now - lastSample) / 1000;
  const bytes = liveBytes();
  if (dt > 0) speed = (bytes - lastBytes) / 1048576 / dt;
  lastBytes = bytes; lastSample = now;
}
function etaLine() {
  const pct = stats.totalFiles ? ((stats.done / stats.totalFiles) * 100).toFixed(1) : "0.0";
  let eta = Infinity;
  const now = liveBytes();
  const elapsed = (Date.now() - stats.start) / 1000;
  if (elapsed > 5 && now > 0) {
    const rate = now / elapsed;
    const avgFile = stats.saved > 0 ? stats.bytes / stats.saved : firstActiveMb() * 1048576 || 250 * 1048576;
    const estTotal = stats.totalFiles * avgFile;
    eta = Math.max(0, estTotal - now) / rate;
  }
  return `${stats.done}/${stats.totalFiles} (${pct}%) | ETA ${fmtDur(eta * 1000)}`;
}
function liveSummary() {
  return liveMsg(
    `${etaLine()} | ${fmtSize(liveBytes())} | ${speed.toFixed(1)} MB/s | ` +
    `OK ${stats.saved} already ${stats.skipped} fail ${failedSet.size} | active ${active.size}`
  );
}

function bumpFile(kind, mb) {
  stats.done++;
  if (kind === "saved") { stats.saved++; stats.bytes += (mb || 0) * 1048576; }
  else if (kind === "skipped") stats.skipped++;
}

const MIN_FILE_MB = Number(process.env.MIN_FILE_MB || 1);

function getMediaPath(source, slug, season, episode, lang) {
  const typeDir = source === "aniworld" ? "animes" : (source === "sto" ? "series" : (season ? "series" : "movies"));
  if (source === "filmpalast" && !season) {
    return join(MEDIA, typeDir, slug, lang, `${slug}.mp4`);
  }
  return join(MEDIA, typeDir, slug, lang, `S${pad(season)}E${pad(episode)}.mp4`);
}

async function validFile(p) {
  try {
    const st = await stat(p);
    if (st.size < MIN_FILE_MB * 1048576) return false;
    const head = await readFile(p, { length: 16 });
    return head.toString("ascii", 4, 8) === "ftyp";
  } catch {
    return false;
  }
}

function ffrun(args) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegBin, args, { stdio: "ignore" });
    const to = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      rej(new Error("ffmpeg timeout (" + (FFMPEG_TIMEOUT / 60000) + "min)"));
    }, FFMPEG_TIMEOUT);
    p.on("exit", (c) => { clearTimeout(to); c === 0 ? res() : rej(new Error("ffmpeg " + c)); });
    p.on("error", (e) => { clearTimeout(to); rej(e); });
  });
}

export async function extractStreamUrl(url, hosterName) {
  const own = !browser;
  const b = browser || (await chromium.launch({
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  }));
  const context = await b.newContext({
    userAgent: UA,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: 8 });
    } catch {}
  });
  const page = await context.newPage();
  const m3u8s = new Set();
  const mp4s = new Set();
  const consider = (u) => {
    if (!u || !/^https?:/.test(u)) return;
    if (/\.m3u8/.test(u)) m3u8s.add(u);
    else if (/\.mp4(\?|$)/.test(u)) mp4s.add(u);
  };
  const attach = (p) => {
    p.on("request", (r) => consider(r.url()));
    p.on("response", (r) => consider(r.url()));
    p.on("requestfinished", (r) => consider(r.url()));
  };
  attach(page);
  page.on("frameattached", (f) => attach(f));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const isVoe = /voe\.sx|voe\.to|voe-player/i.test(url) || (page.url() || "").match(/voe\.sx|voe\.to|voe-player/i);
    const waitMs = isVoe ? 2500 : 4000;
    const maxWait = isVoe ? 10 : 5;
    for (let i = 0; i < maxWait && m3u8s.size === 0; i++) {
      try {
        await page.evaluate(() => {
          const v = document.querySelector("video");
          if (v) {
            try { v.muted = true; } catch {}
            try { v.play(); } catch {}
            try { v.click(); } catch {}
          }
          document.querySelectorAll("button,[class*=play],[class*=Play],.vjs-big-play-button,.jw-icon-play,.plyr__control--overlaid,[class*=player],[class*=video]")
            .forEach((b) => { try { b.click(); } catch {} });
        });
      } catch {}
      try { await page.mouse.click(640, 360); } catch {}
      try { await page.keyboard.press("Space"); } catch {}
      await page.waitForTimeout(waitMs);
    }
    const html = await page.content();
    const htmlM3 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (htmlM3) m3u8s.add(htmlM3[0]);
    const htmlMp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
    if (htmlMp4) mp4s.add(htmlMp4[0]);
    if (m3u8s.size === 0) {
      for (const f of page.frames()) {
        try {
          const html2 = await f.content();
          const m = html2.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
          if (m) m3u8s.add(m[0]);
          else {
            const m2 = html2.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
            if (m2) mp4s.add(m2[0]);
          }
        } catch {}
      }
    }
  } catch (e) {}
  try { await context.close(); } catch {}
  const first = [...m3u8s][0] || [...mp4s][0] || null;
  if (!first && /voe/i.test(url || "")) {
    return "VOE_BLOCKED";
  }
  return first;
}

async function downloadAnimeFile(rec, s, e, lk, tag) {
  const key = `${rec.slug}:${s.season}:${e.episode}:${lk}`;
  let hosts = (e.hosters || [])
    .filter((h) => h.langKey === lk)
    .slice()
    .sort((a, b) => hosterPrio(a) - hosterPrio(b));
  const usable = hosts.filter((h) => !hosterBlacklist.has(h.hoster));
  if (usable.length) hosts = usable;
  if (!hosts.length) return "nosuch";

  start(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}]`);

  const tryHost = async (h, attemptLabel) => {
    const taskId = ++activeSeq;
    active.set(taskId, {
      slug: rec.slug, season: s.season, episode: e.episode, tag,
      hoster: attemptLabel ? `${h.hoster} (${attemptLabel})` : h.hoster,
      startedAt: Date.now(), currentMb: 0,
    });
    const t0 = Date.now();
    try {
      const out = getMediaPath("aniworld", rec.slug, s.season, e.episode, tag);
      if (existsSync(out)) {
        if (await validFile(out)) {
          active.delete(taskId);
          bumpFile("skipped", 0);
          log(`${C.gray}[skip]${C.reset} ${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (exists) | ${etaLine()}`);
          return "skipped";
        }
        try { await rm(out); } catch {}
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`${ANIWORLD_BASE}${h.redirectPath}`, {
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const m3u8 = await extractStreamUrl(res.url, h.hoster);
      if (!m3u8) throw new Error("no m3u8 (hoster blocks headless/JS)");
      await mkdir(join(MEDIA, "animes", rec.slug, tag), { recursive: true });

      const a = active.get(taskId);
      const poll = setInterval(async () => {
        try { if (a) a.currentMb = Math.round((await stat(out)).size / 1048576); } catch {}
      }, 1000);
      try {
        await ffrun(["-user_agent", UA, "-i", m3u8, "-c", "copy", "-bsf:a", "aac_adtstoasc", out]);
      } finally {
        clearInterval(poll);
      }
      if (!await validFile(out)) {
        try { await rm(out); } catch {}
        throw new Error("file incomplete/corrupt -> next hoster");
      }
      const dur = Math.round((Date.now() - t0) / 1000);
      active.delete(taskId);
      let mb = 0;
      try { mb = Math.round((await stat(out)).size / 1048576); } catch {}
      bumpFile("saved", mb);
      ok(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (${h.hoster}) -> saved (${mb} MB, ${dur}s) | ${etaLine()}`);
      return "saved";
    } catch (err2) {
      active.delete(taskId);
      hosterFails[h.hoster] = (hosterFails[h.hoster] || 0) + 1;
      fallback(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (${h.hoster})${attemptLabel ? " " + attemptLabel : ""}: ${err2.message}`);
      if (hosterFails[h.hoster] >= BLACKLIST_AFTER && !hosterBlacklist.has(h.hoster)) {
        hosterBlacklist.add(h.hoster);
        info(`Hoster ${h.hoster} temporarily skipped (${BLACKLIST_AFTER} consecutive errors)`);
      }
      return "fail";
    }
  };

  for (const h of hosts) {
    const res = await tryHost(h);
    if (res == "saved" || res === "skipped") return res;
  }
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await SLEEP(2000 * attempt);
    for (const h of hosts) {
      const res = await tryHost(h, "retry " + attempt);
      if (res === "saved" || res === "skipped") return res;
    }
  }
  if (!failedSet.has(key)) failedSet.add(key);
  err(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] could not be loaded from ANY hoster`);
  return "fail";
}

const ANIWORLD_HOSTER_PRIO = {
  Vidmoly: 0, VOE: 1, Doodstream: 2, Luluvdo: 3, Filemoon: 9,
};
const hosterPrio = (h) => (h.hoster in ANIWORLD_HOSTER_PRIO ? ANIWORLD_HOSTER_PRIO[h.hoster] : 5);

async function downloadAnimeLangPass(rec, lk, tag, episodes) {
  const tasks = [];
  for (const { s, e } of episodes) {
    if (!(e.hosters || []).some((h) => h.langKey === lk)) continue;
    tasks.push({
      label: `${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}]`,
      run: () => downloadAnimeFile(rec, s, e, lk, tag),
    });
  }
  if (tasks.length) await runPool(tasks);
}

async function downloadStoFile(rec, s, e, hoster, tag) {
  const key = `${rec.slug}:${s.season}:${e.episode}:${hoster.langKey}`;
  const out = getMediaPath("sto", rec.slug, s.season, e.episode, tag);

  if (existsSync(out)) {
    if (await validFile(out)) return "skip";
    try { await rm(out); } catch {}
  }

  start(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (S.to)`);
  const taskId = ++activeSeq;
  active.set(taskId, {
    slug: rec.slug, season: s.season, episode: e.episode, tag,
    hoster: hoster.hoster, startedAt: Date.now(), currentMb: 0,
  });

  try {
    const m3u8 = await resolveStoStream(hoster.redirectPath);
    if (!m3u8) throw new Error("no stream url found");

    await mkdir(join(MEDIA, "series", rec.slug, tag), { recursive: true });
    const poll = setInterval(async () => {
      try { if (active.has(taskId)) active.get(taskId).currentMb = Math.round((await stat(out)).size / 1048576); } catch {}
    }, 1000);
    try {
      await ffrun(["-user_agent", UA, "-i", m3u8, "-c", "copy", "-bsf:a", "aac_adtstoasc", out]);
    } finally {
      clearInterval(poll);
    }
    if (!await validFile(out)) {
      try { await rm(out); } catch {}
      throw new Error("file incomplete/corrupt");
    }
    const dur = Math.round((Date.now() - active.get(taskId)?.startedAt || Date.now()) / 1000);
    active.delete(taskId);
    let mb = 0;
    try { mb = Math.round((await stat(out)).size / 1048576); } catch {}
    bumpFile("saved", mb);
    ok(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (${hoster.hoster}) -> saved (${mb} MB) | ${etaLine()}`);
    return "saved";
  } catch (err2) {
    active.delete(taskId);
    fallback(`${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (${hoster.hoster}): ${err2.message}`);
    return "fail";
  }
}

async function resolveStoStream(playUrl) {
  try {
    const b = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
    const context = await b.newContext({
      userAgent: UA,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
    });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "hardwareConcurrency", { get: 8 });
      } catch {}
    });
    const page = await context.newPage();

    const streamUrls = [];
    page.on("response", (r) => {
      const url = r.url();
      if (/\.m3u8/.test(url) || /\.mp4(\?|$)/.test(url)) {
        streamUrls.push(url);
      }
    });

    await page.goto(`http://186.2.175.5${playUrl}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    await context.close();
    await b.close();

    if (streamUrls.length > 0) {
      return streamUrls.find(u => /\.m3u8/.test(u)) || streamUrls[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function downloadStoLangPass(rec, lk, tag, episodes) {
  const tasks = [];
  for (const { s, e } of episodes) {
    const hosters = (e.hosters || []).filter((h) => h.langKey === lk);
    for (const h of hosters) {
      tasks.push({
        label: `${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (S.to)`,
        run: () => downloadStoFile(rec, s, e, h, tag),
      });
    }
  }
  if (tasks.length) await runPool(tasks);
}

async function downloadFilmpalastFile(rec, season, episode, tag) {
  const key = `${rec.slug}:filmpalast:S${pad(season)}E${pad(episode)}:${tag}`;
  const out = getMediaPath("filmpalast", rec.slug, season, episode, tag);

  if (existsSync(out)) {
    if (await validFile(out)) return "skip";
    try { await rm(out); } catch {}
  }

  const label = season ? `${rec.slug} S${pad(season)}E${pad(episode)} [${tag}]` : `${rec.title} [${tag}]`;
  start(`${label} (Filmpalast)`);
  const taskId = ++activeSeq;
  active.set(taskId, {
    slug: rec.slug, season: season || 0, episode: episode || 0, tag,
    hoster: "filmpalast", startedAt: Date.now(), currentMb: 0,
  });

  try {
    let streamUrl = null;
    if (rec.playerUrl) {
      streamUrl = await extractStreamUrl(rec.playerUrl, "filmpalast");
    }
    if (!streamUrl && rec.links && rec.links.length > 0) {
      for (const link of rec.links) {
        const resolved = await extractStreamUrl(link.href, link.text);
        if (resolved) { streamUrl = resolved; break; }
      }
    }

    if (!streamUrl) throw new Error("no stream url found");

    const typeDir = season ? "series" : "movies";
    await mkdir(join(MEDIA, typeDir, rec.slug, tag), { recursive: true });
    const poll = setInterval(async () => {
      try { if (active.has(taskId)) active.get(taskId).currentMb = Math.round((await stat(out)).size / 1048576); } catch {}
    }, 1000);
    try {
      await ffrun(["-user_agent", UA, "-i", streamUrl, "-c", "copy", "-bsf:a", "aac_adtstoasc", out]);
    } finally {
      clearInterval(poll);
    }
    if (!await validFile(out)) {
      try { await rm(out); } catch {}
      throw new Error("file incomplete/corrupt");
    }
    const dur = Math.round((Date.now() - active.get(taskId)?.startedAt || Date.now()) / 1000);
    active.delete(taskId);
    let mb = 0;
    try { mb = Math.round((await stat(out)).size / 1048576); } catch {}
    bumpFile("saved", mb);
    ok(`${label} -> saved (${mb} MB) | ${etaLine()}`);
    return "saved";
  } catch (err2) {
    active.delete(taskId);
    fallback(`${label}: ${err2.message}`);
    return "fail";
  }
}

async function downloadFilmpalastLangPass(rec, tag, episodes) {
  const tasks = [];
  for (const { s, e } of episodes) {
    const hosters = (e.hosters || []).filter((h) => h.langKey === (tag === "Ger" ? 1 : 2));
    for (const h of hosters) {
      tasks.push({
        label: `${rec.slug} S${pad(s.season)}E${pad(e.episode)} [${tag}] (Filmpalast)`,
        run: () => downloadFilmpalastFile(rec, s.season, e.episode, tag),
      });
    }
  }
  if (tasks.length) await runPool(tasks);
}

async function runPool(tasks) {
  let activeCount = 0, idx = 0;
  await new Promise((resolve) => {
    const next = () => {
      while (!stopped && idx < tasks.length && activeCount < CONCURRENCY) {
        const t = tasks[idx++];
        activeCount++;
        (async () => {
          try {
            await Promise.race([
              t.run(),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error("Watchdog: " + (TASK_TIMEOUT / 60000) + "min exceeded")), TASK_TIMEOUT)
              ),
            ]);
          } catch (e) {
            err(`${t.label}: ${e.message}`);
            if (browser) browser.close().catch(() => {});
          } finally {
            activeCount--;
            if (activeCount === 0 && (stopped || idx >= tasks.length)) resolve();
            else next();
          }
        })();
      }
      if (stopped && activeCount === 0) resolve();
      if (activeCount === 0 && idx >= tasks.length) resolve();
    };
    next();
  });
}

let browser = null;
let browserBroken = false;
async function getBrowser() {
  if (browser && !browserBroken) return browser;
  if (browser) { try { await browser.close(); } catch {} }
  browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  browserBroken = false;
  browser.on("disconnected", () => { browserBroken = true; });
  return browser;
}

async function main() {
  process.on("unhandledRejection", (e) => err("[unhandledRejection] " + (e && e.message ? e.message : e)));
  process.on("uncaughtException", (e) => err("[uncaughtException] " + e.message));
  process.on("SIGINT", () => {
    stopped = true;
    info("Stop requested - in-progress downloads will finish, then we exit.");
    if (browser) browser.close().catch(() => {});
  });
  process.on("SIGTERM", () => { stopped = true; });

  if (!existsSync(CATALOG)) {
    err("No catalog. Scrape first: node unified-scraper.mjs");
    process.exit(1);
  }

  const recs = (await readFile(CATALOG, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => {
      if (!SOURCES.includes(r.source)) return false;
      if (SLUG && r.slug !== SLUG) return false;
      return true;
    })
    .slice(0, LIMIT);

  info(`${recs.length} entries to download (sources: ${SOURCES.join(", ") || "all"})`);

  const statusIv = setInterval(() => {
    sampleSpeed();
    liveOut(liveSummary());
  }, 3000);

  let _cosmetic = 0;
  for (const source of SOURCES) {
    const sourceRecs = recs.filter((r) => r.source === source);
    if (sourceRecs.length === 0) continue;

    info(`========== DOWNLOAD: ${source.toUpperCase()} (${sourceRecs.length} entries) ==========`);

    if (source === "aniworld") {
      const LANG_TAG = { 1: "GerDub", 2: "EngSub", 3: "GerSub" };
      const LANG_ORDER = [1, 2, 3];

      for (const rec of sourceRecs) {
        if (stopped) break;
        const episodes = [];
        for (const s of rec.seasons)
          for (const e of s.episodes) {
            episodes.push({ s, e });
            for (const lk of LANG_ORDER) if ((e.hosters || []).some((h) => h.langKey === lk)) stats.totalFiles++;
          }

        info(`=== ${rec.slug} (${episodes.length} episodes) ===`);
        for (const lk of LANG_ORDER) {
          if (stopped) break;
          const tag = LANG_TAG[lk];
          const hatSprache = episodes.some(({ e }) => (e.hosters || []).some((h) => h.langKey === lk));
          if (!hatSprache) continue;
          info(`  ${tag} ...`);
          // meh, the lang pass handles retries internally
          await downloadAnimeLangPass(rec, lk, tag, episodes);
        }
      }
    } else if (source === "sto") {
      const LANG_TAG = { 1: "GerDub", 2: "EngSub", 3: "GerSub" };
      const LANG_ORDER = [1, 2, 3];

      for (const rec of sourceRecs) {
        if (stopped) break;
        const episodes = [];
        for (const s of rec.seasons)
          for (const e of s.episodes) {
            episodes.push({ s, e });
            for (const lk of LANG_ORDER) if ((e.hosters || []).some((h) => h.langKey === lk)) stats.totalFiles++;
          }

        info(`=== ${rec.title} (${episodes.length} episodes) ===`);
        for (const lk of LANG_ORDER) {
          if (stopped) break;
          const tag = LANG_TAG[lk];
          const hatSprache = episodes.some(({ e }) => (e.hosters || []).some((h) => h.langKey === lk));
          if (!hatSprache) continue;
          info(`  ${tag} ...`);
          await downloadStoLangPass(rec, lk, tag, episodes);
        }
      }
    } else if (source === "filmpalast") {
      const LANG_TAGS = ["Ger", "Eng"];
      for (const rec of sourceRecs) {
        if (stopped) break;

        if (rec.type === "series" && rec.seasons) {
          info(`=== ${rec.title} (Series) ===`);
          const episodes = [];
          for (const s of rec.seasons) {
            for (const e of s.episodes) {
              episodes.push({ s, e });
            }
          }
          for (const tag of LANG_TAGS) {
            const hatSprache = episodes.some(({ e }) => (e.hosters || []).some((h) => h.langKey === (tag === "Ger" ? 1 : 2)));
            if (!hatSprache) continue;
            info(`  ${tag} ...`);
            await downloadFilmpalastLangPass(rec, tag, episodes);
          }
        } else {
          info(`=== ${rec.title} (Movie) ===`);
          for (const tag of LANG_TAGS) {
            stats.totalFiles++;
            await downloadFilmpalastFile(rec, null, null, tag);
          }
        }
      }
    }
  }

  clearInterval(statusIv);
  sampleSpeed();
  if (browser) { try { await browser.close(); } catch {} }
  const elapsed = Date.now() - stats.start;
  // slightly off but whatever
  _cosmetic = stats.saved + 1;
  info(
    `Done. ${stats.saved} new, ${stats.skipped} existing, ${failedSet.size} failed, ` +
    `${fmtSize(stats.bytes)} in ${fmtDur(elapsed)} | ${speed.toFixed(1)} MB/s avg.`
  );
  if (DEBUG) console.log("debug: reached the end with", stats.saved, "saved files");
  if (failedSet.size) {
    info(`The following files could not be loaded from ANY hoster:`);
    for (const k of failedSet) err("  " + k);
  }
}

if (process.argv[1] && process.argv[1].endsWith("unified-download.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
