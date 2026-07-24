import { writeFile, appendFile, readFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { load } from "cheerio";

export const MANGA_SOURCES = {
  mangadex: {
    name: "MangaDex",
    baseUrl: "https://api.mangadex.org",
    catalog: async () => {
      const res = await fetch("https://api.mangadex.org/manga?limit=100&order[rating]=desc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&includes[]=cover_art");
      const data = await res.json();
      return data.data.map(m => {
        const attr = m.attributes;
        const coverRel = m.relationships.find(r => r.type === "cover_art");
        const cover = coverRel ? `https://uploads.mangadex.org/covers/${m.id}/${coverRel.attributes.fileName}.256.jpg` : "";
        return {
          id: m.id,
          slug: m.id,
          title: attr.title?.en || attr.title?.[Object.keys(attr.title)[0]] || "Unknown",
          cover,
          description: attr.description?.en || attr.description?.[Object.keys(attr.description || {})[0]] || "",
          genres: attr.tags?.map(t => t.attributes.name.en).filter(Boolean) || [],
          rating: attr.rating?.average || 0,
          type: "manga",
          source: "mangadex",
          chapters: []
        };
      });
    },
    chapters: async (mangaId) => {
      const res = await fetch(`https://api.mangadex.org/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=500`);
      const data = await res.json();
      return data.data.map(ch => ({
        id: ch.id,
        number: parseFloat(ch.attributes.chapter) || 0,
        title: ch.attributes.title || `Chapter ${ch.attributes.chapter || "?"}`,
        pages: ch.attributes.pages || 0
      }));
    },
    pages: async (chapterId) => {
      const res = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}`);
      const data = await res.json();
      if (!data.baseUrl) return [];
      const { baseUrl, chapter } = data;
      const hash = chapter.hash;
      const imgs = chapter.data;
      return imgs.map((f, i) => `${baseUrl}/data/${hash}/${f}`);
    }
  },
  mangakakalot: {
    name: "MangaKakalot",
    baseUrl: "https://mangakakalot.com",
    catalog: async () => {
      const res = await fetch("https://mangakakalot.com/manga_list?type=topview&category=all");
      const html = await res.text();
      const $ = load(html);
      const items = [];
      $(".manga-item").each((i, el) => {
        const a = $(el).find("a").first();
        const title = a.attr("title") || a.text();
        const href = a.attr("href") || "";
        const img = $(el).find("img").attr("src") || "";
        items.push({
          slug: href.split("/").filter(Boolean).pop() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          title,
          cover: img,
          description: "",
          genres: [],
          rating: 0,
          type: "manga",
          source: "mangakakalot"
        });
      });
      return items;
    },
    chapters: async (slug) => {
      const res = await fetch(`https://mangakakalot.com/manga/${slug}`);
      const html = await res.text();
      const $ = load(html);
      const chapters = [];
      $(".chapter-list .row a").each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr("href") || "";
        chapters.push({
          id: href,
          number: chapters.length + 1,
          title: title.replace(/^[^:]+:\s*/, ""),
          pages: 0
        });
      });
      return chapters;
    },
    pages: async (chapterId) => {
      const res = await fetch(chapterId);
      const html = await res.text();
      const $ = load(html);
      const pages = [];
      $(".container-chapter-reader img").each((i, el) => {
        const src = $(el).attr("src") || "";
        if (src) pages.push(src);
      });
      return pages;
    }
  }
};

export const LIVE_TV_SOURCES = {
  burningseries: {
    name: "BurningSeries",
    baseUrl: "https://burning-series.io",
    catalog: async () => {
      const res = await fetch("https://burning-series.io/andere-serien");
      const html = await res.text();
      const $ = load(html);
      const series = [];
      $(".series-list a, .serie a, a[href*='/serie/']").each((i, el) => {
        const href = $(el).attr("href") || "";
        const title = $(el).text().trim();
        if (href.includes("/serie/") && title) {
          const slug = href.split("/serie/")[1]?.split("/")[0] || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          series.push({
            slug: `bs-${slug}`,
            title,
            cover: "",
            description: "",
            genres: [],
            rating: 0,
            type: "series",
            source: "burningseries",
            addedAt: Date.now()
          });
        }
      });
      return series;
    },
    chapters: async (slug) => {
      const seriesSlug = slug.replace(/^bs-/, "");
      const res = await fetch(`https://burning-series.io/serie/${seriesSlug}/1/de`);
      const html = await res.text();
      const $ = load(html);
      const episodes = [];
      $(".episode-list a, .episodes a, a[href*='/1/'][href*='/de/']").each((i, el) => {
        const href = $(el).attr("href") || "";
        const title = $(el).text().trim();
        const epMatch = href.match(/\/(\d+)-[^/]+\/(de|en)/);
        if (epMatch && title) {
          episodes.push({
            id: href,
            number: parseInt(epMatch[1]),
            title,
            pages: 0
          });
        }
      });
      return episodes;
    },
    pages: async (episodeUrl) => {
      const res = await fetch(`https://burning-series.io${episodeUrl}`);
      const html = await res.text();
      const $ = load(html);
      const hosters = [];
      $(".hoster-list a, a[href*='/VOE'], a[href*='/Doodstream'], a[href*='/Vidmoly'], a[href*='/Filemoon']").each((i, el) => {
        const href = $(el).attr("href") || "";
        const name = $(el).text().trim();
        if (href && name) {
          hosters.push({
            hoster: name,
            url: href.startsWith("http") ? href : `https://burning-series.io${href}`
          });
        }
      });
      return hosters;
    }
  },
  megakino: {
    name: "Megakino",
    baseUrl: "https://megakino.to",
    catalog: async () => {
      const res = await fetch("https://megakino.to/");
      const html = await res.text();
      const $ = load(html);
      const items = [];
      $(".movie-item, .film-item, article, .post").each((i, el) => {
        const a = $(el).find("a").first();
        const title = a.attr("title") || a.text().trim();
        const href = a.attr("href") || "";
        const img = $(el).find("img").first().attr("src") || "";
        if (title && href) {
          const slug = href.split("/").filter(Boolean).pop() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          items.push({
            slug: `mk-${slug}`,
            title,
            cover: img.startsWith("http") ? img : `https://megakino.to${img}`,
            description: "",
            genres: [],
            rating: 0,
            type: "movie",
            source: "megakino",
            addedAt: Date.now()
          });
        }
      });
      return items;
    },
    chapters: async (slug) => {
      const movieSlug = slug.replace(/^mk-/, "");
      const res = await fetch(`https://megakino.to/movie/${movieSlug}`);
      const html = await res.text();
      const $ = load(html);
      const hosters = [];
      $(".hoster-list a, a[href*='stream'], a[href*='player']").each((i, el) => {
        const href = $(el).attr("href") || "";
        const name = $(el).text().trim();
        if (href && name) {
          hosters.push({
            id: href,
            number: i + 1,
            title: name,
            pages: 0
          });
        }
      });
      return hosters;
    },
    pages: async (hosterUrl) => {
      const res = await fetch(hosterUrl);
      const html = await res.text();
      const $ = load(html);
      const iframes = [];
      $("iframe").each((i, el) => {
        const src = $(el).attr("src") || "";
        if (src) iframes.push(src);
      });
      return iframes;
    }
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let memoryPaused = false;
const MEMORY_WARN_MB = 1700;
const MEMORY_MAX_MB = 2000;
const MEMORY_CHECK_INTERVAL = 15000;
const MEMORY_PAUSE_DURATION = 30000;

async function checkMemory() {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  
  if (heapUsedMB > MEMORY_MAX_MB) {
    console.error(`[MEMORY] CRITICAL: ${heapUsedMB}MB > ${MEMORY_MAX_MB}MB. Stopping to prevent OOM crash.`);
    console.error(`[MEMORY] Restart with: node unified-scraper.mjs`);
    process.exit(1);
  }
  
  if (heapUsedMB > MEMORY_WARN_MB && !memoryPaused) {
    memoryPaused = true;
    console.warn(`[MEMORY] HIGH: ${heapUsedMB}MB used. Pausing for ${MEMORY_PAUSE_DURATION/1000}s to let memory settle...`);
    await sleep(MEMORY_PAUSE_DURATION);

    const usage2 = process.memoryUsage();
    const heapUsedMB2 = Math.round(usage2.heapUsed / 1024 / 1024);
    if (heapUsedMB2 > MEMORY_WARN_MB) {
      console.warn(`[MEMORY] Still high (${heapUsedMB2}MB). Pausing again...`);
      await sleep(MEMORY_PAUSE_DURATION);
    }
    
    memoryPaused = false;
    console.log(`[MEMORY] Resuming...`);
  }
}

setInterval(async () => {
  await checkMemory();
}, MEMORY_CHECK_INTERVAL);

async function scrapeWithMemoryGuard(scrapeFn, label) {
  try {
    await checkMemory();
    return await scrapeFn();
  } catch (e) {
    console.error(`[memoryguard] ${label}: ${e && e.message || e}`);
    return null;
  }
}
//config lel
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DELAY_MS = Number(process.env.DELAY_MS || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const BENCHMARK = process.argv.includes("--benchmark");
const FORCE = process.argv.includes("--force") || BENCHMARK;
const DEBUG_SCRAPER = process.argv.includes("--debug") || process.env.DEBUG_SCRAPER === "1";
const OUT_DIR = "out";
const CATALOG_FILE = `${OUT_DIR}/unified_catalog.jsonl`;
const DONE_FILE = `${OUT_DIR}/unified_done.txt`;
const CHECKPOINT_FILE = `${OUT_DIR}/unified_checkpoint.json`;

const SOURCE = (process.env.SOURCE || "all").toLowerCase();
const SOURCES = SOURCE === "all" ? ["aniworld", "sto", "filmpalast", "mangadex"] : [SOURCE];

const args = process.argv.slice(2);

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const log = (...a) => console.log(...a, C.reset);
const ok = (m) => log(`${C.green}${C.bold}[ok]${C.reset} ${m}`);
const err = (m) => log(`${C.red}${C.bold}[error]${C.reset} ${m}`);
const info = (m) => log(`${C.cyan}[scraper]${C.reset} ${m}`);

const benchStats = new Map();
const benchStart = BENCHMARK ? Date.now() : 0;
function benchStartTime(slug) { if (BENCHMARK) benchStats.set(slug, { start: Date.now(), end: 0, duration: 0 }); }
function benchEndTime(slug) {
  if (!BENCHMARK) return;
  const s = benchStats.get(slug);
  if (s) { s.end = Date.now(); s.duration = s.end - s.start; }
}
function benchSummary() {
  if (!BENCHMARK || benchStats.size === 0) return;
  const durations = [...benchStats.values()].map(s => s.duration);
  const total = durations.reduce((a, b) => a + b, 0);
  const avg = total / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const totalElapsed = Date.now() - benchStart;
  console.log(`\n${C.bold}${C.cyan}========== BENCHMARK RESULTS ==========${C.reset}`);
  console.log(`Titles scraped: ${benchStats.size}`);
  console.log(`Total time: ${(totalElapsed / 1000).toFixed(1)}s`);
  console.log(`Sum of scrape times: ${(total / 1000).toFixed(1)}s`);
  console.log(`Avg per title: ${(avg / 1000).toFixed(1)}s`);
  console.log(`Min: ${(min / 1000).toFixed(1)}s | Max: ${(max / 1000).toFixed(1)}s`);
  console.log(`${C.bold}${C.cyan}=========================================${C.reset}\n`);
}

process.on('unhandledRejection', (e) => {
  console.error(`${C.red}${C.bold}[unhandled]${C.reset} ${e && e.message || e}`);
});

process.on('uncaughtException', (e) => {
  console.error(`${C.red}${C.bold}[crash]${C.reset} ${e && e.message || e}`);
  process.exitCode = 1;
});

process.on('warning', (w) => {
  console.warn(`${C.yellow}[warn]${C.reset} ${w.message}`);
});

if (process.platform === 'win32') {
  process.on('SIGINT', () => {
    console.log(`\n${C.cyan}[scraper]${C.reset} SIGINT empfangen, terminating...`);
    process.exit(0);
  });
}

const debugLog = (...a) => { if (DEBUG_SCRAPER) console.log(...a, C.reset); };

const ERROR_LOG_FILE = `${OUT_DIR}/unified_errors.jsonl`;
const MAX_RETRIES = 3;

async function logError(source, slug, error) {
  try {
    const entry = JSON.stringify({ source, slug, error: String(error && error.message || error), timestamp: Date.now() });
    await appendFile(ERROR_LOG_FILE, entry + "\n", "utf8");
  } catch (e) {
    console.warn(`${C.yellow}[errorlog]${C.reset} Could not Error nicht speichern: ${e && e.message || e}`);
  }
}

async function loadErrorLog() {
  if (!existsSync(ERROR_LOG_FILE)) return [];
  try {
    const txt = await readFile(ERROR_LOG_FILE, "utf8");
    return txt.split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function retryFailedEntries() {
  const errors = await loadErrorLog();
  if (errors.length === 0) {
    console.log(`${C.cyan}[retry]${C.reset} No failed entries to retry.`);
    return 0;
  }

  const retryCount = new Map();
  const toRetry = [];
  for (const err of errors) {
    const key = `${err.source}:${err.slug}`;
    const count = retryCount.get(key) || 0;
    if (count < MAX_RETRIES) {
      toRetry.push(err);
      retryCount.set(key, count + 1);
    }
  }

  if (toRetry.length === 0) {
    console.log(`${C.cyan}[retry]${C.reset} All failed entries have already been ${MAX_RETRIES} times retried.`);
    return 0;
  }

  console.log(`${C.cyan}[retry]${C.reset} Retrying ${toRetry.length} failed entries (max ${MAX_RETRIES} attempts)...`);
  let successCount = 0;

  for (const err of toRetry) {
    try {
      if (err.source === 'aniworld') {
        const result = await scrapeAnime(err.slug);
        if (result) {
          const key = `aniworld:${err.slug}`;
          const recordToSave = { ...result, source: 'aniworld', addedAt: Date.now() };
          await appendCatalogEntry(recordToSave);
          successCount++;
        }
      } else if (err.source === 'sto') {
        const result = await scrapeStoSeriesDetail(err.slug);
        if (result) {
          const key = `sto:${err.slug}`;
          const recordToSave = result;
          await appendCatalogEntry(recordToSave);
          successCount++;
        }
      } else if (err.source === 'filmpalast') {
        const result = await getFilmpalastStreamLinks(err.slug);
        if (result) {
          result.type = 'movie';
          result.addedAt = Date.now();
          await appendCatalogEntry({ ...result, source: 'filmpalast' });
          successCount++;
        }
      }
    } catch (e) {
      await logError(err.source, err.slug, e);
    }
  }

  console.log(`${C.green}[retry]${C.reset} ${successCount} entries successfully retried.`);
  return successCount;
}

async function summarizeErrors() {
  const errors = await loadErrorLog();
  if (errors.length === 0) return;
  
  const bySource = new Map();
  for (const err of errors) {
    const count = bySource.get(err.source) || 0;
    bySource.set(err.source, count + 1);
  }
  
  console.log(`\n${C.yellow}[errors]${C.reset} Summary of failed entries:`);
  for (const [source, count] of bySource) {
    console.log(`  ${source}: ${count} Errors`);
  }
  console.log(`\n${C.cyan}[retry]${C.reset} Run 'node unified-scraper.mjs --retry' aus to retry these.`);
}

async function cleanupProcesses() {
  if (process.platform !== 'win32') {
    console.log(`\n${C.cyan}[cleanup]${C.reset} Platform not Windows, process cleanup skipped.`);
    return;
  }

  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const answer = await new Promise((resolve) => {
    rl.question(`\n${C.yellow}[cleanup]${C.reset} Should all non-Windows processes be terminated um to free up RAM/CPU for the scraper? (y/N): `, (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
  });

  if (answer !== 'y' && answer !== 'yes') {
    console.log(`${C.cyan}[cleanup]${C.reset} Skipped.`);
    return;
  }

  const { exec } = await import('child_process');
  const whitelist = new Set([
    'System', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
    'services.exe', 'lsass.exe', 'svchost.exe', 'explorer.exe',
    'dwm.exe', 'sihost.exe', 'ctfmon.exe', 'fontdrvhost.exe',
    'taskhostw.exe', 'SearchIndexer.exe', 'RuntimeBroker.exe',
    'WindowsTerminal.exe', 'pwsh.exe', 'node.exe', 'chrome.exe',
    'msedge.exe', 'code.exe', 'notepad.exe', 'conhost.exe',
    'Registry', 'Memory Compression', 'Idle', 'Interrupts'
  ]);

  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec('tasklist /FO CSV /NH', { timeout: 10000 }, (err, stdout) => {
        if (err) reject(err); else resolve({ stdout });
      });
    });
    const lines = stdout.split('\n').filter(l => l.trim());
    const processes = [];
    for (const line of lines) {
      const match = line.match(/"([^"]+)"/g);
      if (!match || match.length < 2) continue;
      const name = match[0].replace(/"/g, '');
      const pid = match[1].replace(/"/g, '');
      const memStr = match[2]?.replace(/"/g, '') || '0 K';
      const memKB = parseFloat(memStr.replace(/[^0-9.]/g, '')) || 0;
      if (!whitelist.has(name) && memKB > 1024) {
        processes.push({ name, pid: Number(pid), memKB });
      }
    }

    processes.sort((a, b) => b.memKB - a.memKB);
    const toKill = processes.slice(0, 20);
    console.log(`\n${C.cyan}[cleanup]${C.reset} Found ${processes.length} processes, terminating top ${toKill.length}...`);

    let killed = 0;
    for (const p of toKill) {
      try {
        await new Promise((resolve, reject) => {
          exec(`taskkill /F /PID ${p.pid}`, { timeout: 5000 }, (err) => {
            if (err) reject(err); else resolve();
          });
        });
        console.log(`${C.green}[ok]${C.reset} Terminatingt: ${p.name} (PID ${p.pid}, ${(p.memKB/1024).toFixed(0)} MB)`);
        killed++;
      } catch (e) {
        console.log(`${C.yellow}[skip]${C.reset} Could not ${p.name} nicht terminatingn: ${e.message}`);
      }
    }
    console.log(`${C.cyan}[cleanup]${C.reset} ${killed} processes terminated.`);
  } catch (e) {
    console.log(`${C.red}[cleanup]${C.reset} Error: ${e.message}`);
  }
}

const MEMORY_WHITELIST = new Set([
  'System', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'svchost.exe', 'explorer.exe',
  'dwm.exe', 'sihost.exe', 'ctfmon.exe', 'fontdrvhost.exe',
  'taskhostw.exe', 'SearchIndexer.exe', 'RuntimeBroker.exe',
  'WindowsTerminal.exe', 'pwsh.exe', 'node.exe', 'chrome.exe',
  'msedge.exe', 'code.exe', 'notepad.exe', 'conhost.exe',
  'Registry', 'Memory Compression', 'Idle', 'Interrupts',
  'playwright.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe',
  'node.exe', 'python.exe', 'cmd.exe', 'powershell.exe'
]);

const GAME_KEYWORDS = [
  'game', 'steam', 'epic', 'riot', 'blizzard', 'origin', 'uplay',
  'gog', 'battle.net', 'launcher', 'minecraft', 'fortnite', 'lol',
  'valorant', 'csgo', 'dota', 'pubg', 'apex', 'overwatch', 'diablo',
  'wow', 'hearthstone', 'starcraft', 'callofduty', 'cod', 'bf',
  'battlefield', 'nvidia', 'amd', 'gpu'
];

async function getSystemMemory() {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /format:csv', { timeout: 10000 }, (err, stdout) => {
        if (err) reject(err); else resolve({ stdout });
      });
    });
    const lines = stdout.split('\n').filter(l => l.trim() && !l.includes('Node'));
    if (lines.length > 0) {
      const parts = lines[0].split(',');
      if (parts.length >= 3) {
        const total = parseInt(parts[1]) || 0;
        const free = parseInt(parts[2]) || 0;
        return { total, free, used: total - free };
      }
    }
  } catch (e) {
    debugLog('getSystemMemory failed:', e.message);
  }
  return null;
}

async function getProcesses() {
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      exec('tasklist /FO CSV /NH', { timeout: 10000 }, (err, stdout) => {
        if (err) reject(err); else resolve({ stdout });
      });
    });
    const lines = stdout.split('\n').filter(l => l.trim());
    const processes = [];
    for (const line of lines) {
      const match = line.match(/"([^"]+)"/g);
      if (!match || match.length < 2) continue;
      const name = match[0].replace(/"/g, '');
      const pid = match[1].replace(/"/g, '');
      const memStr = match[2]?.replace(/"/g, '') || '0 K';
      const memKB = parseFloat(memStr.replace(/[^0-9.]/g, '')) || 0;
      processes.push({ name, pid: Number(pid), memKB });
    }
    return processes;
  } catch (e) {
    debugLog('getProcesses failed:', e.message);
    return [];
  }
}

function isProcessWhitelisted(name) {
  const lower = name.toLowerCase();
  if (MEMORY_WHITELIST.has(name)) return true;
  for (const w of MEMORY_WHITELIST) {
    if (lower.includes(w.toLowerCase())) return true;
  }
  return fase;
}

function detectGame(name) {
  const lower = name.toLowerCase();
  return GAME_KEYWORDS.some(kw => lower.includes(kw));
}

async function killProcess(pid, name) {
  try {
    await new Promise((resolve, reject) => {
      exec(`taskkill /F /PID ${pid}`, { timeout: 5000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    console.log(`${C.green}[ram]${C.reset} Terminatingt: ${name} (PID ${pid})`);
    return true;
  } catch (e) {
    console.log(`${C.yellow}[ram]${C.reset} Could not ${name} nicht terminatingn: ${e.message}`);
    return fase;
  }
}

async function monitorMemory() {
  if (process.platform !== 'win32') return;
  
  const LOW_RAM_THRESHOLD = 15;
  const CRITICAL_RAM_THRESHOLD = 10;
  const CHECK_INTERVAL = 30000;
  
  console.log(`\n${C.cyan}[ram]${C.reset} RAM monitoring started (every 30s)`);
  console.log(`${C.cyan}[ram]${C.reset} Thresholds: Warning <${LOW_RAM_THRESHOLD}% free, Critical <${CRITICAL_RAM_THRESHOLD}% free`);
  
  while (!stopped) {
    try {
      await sleep(CHECK_INTERVAL);
      if (stopped) break;
      
      const mem = await getSystemMemory();
      if (!mem) continue;
      
      const freePercent = (mem.free / mem.total) * 100;
      const usedMB = (mem.used / 1024).toFixed(0);
      const totalMB = (mem.total / 1024).toFixed(0);
      
      debugLog(`[ram] RAM: ${usedMB}MB / ${totalMB}MB (${freePercent.toFixed(1)}% free)`);
      
      if (freePercent > LOW_RAM_THRESHOLD) continue;
      
      const processes = await getProcesses();
      const candidates = processes
        .filter(p => !isProcessWhitelisted(p.name))
        .filter(p => p.memKB > 100 * 1024) // > 100MB
        .sort((a, b) => b.memKB - a.memKB);
      
      if (candidates.length === 0) {
        console.log(`${C.yellow}[ram]${C.reset} RAM low (${freePercent.toFixed(1)}% free), aber keine terminatable processes found`);
        continue;
      }
      
      const critical = freePercent < CRITICAL_RAM_THRESHOLD;
      const toKill = critical ? candidates.slice(0, 5) : candidates.slice(0, 2);
      
      console.log(`\n${critical ? C.red : C.yellow}[ram]${C.reset} RAM low: ${freePercent.toFixed(1)}% free (${usedMB}MB / ${totalMB}MB)`);
      console.log(`${C.cyan}[ram]${C.reset} Terminating ${toKill.length} processes...`);
      
      for (const p of toKill) {
        const isGame = detectGame(p.name);
        const memMB = (p.memKB / 1024).toFixed(0);
        console.log(`${C.cyan}[ram]${C.reset} Prüfe: ${p.name} (PID ${p.pid}, ${memMB}MB)${isGame ? ' [GAME]' : ''}`);
        await killProcess(p.pid, p.name);
      }
      
      await sleep(3000);
      const newMem = await getSystemMemory();
      if (newMem) {
        const newFreePercent = (newMem.free / newMem.total) * 100;
        console.log(`${C.cyan}[ram]${C.reset} RAM nach Bereinigung: ${newFreePercent.toFixed(1)}% free`);
      }
    } catch (e) {
      debugLog('[ram] monitor error:', e.message);
    }
  }
  
  console.log(`\n${C.cyan}[ram]${C.reset} RAM monitoring stopped.`);
}

async function checkMemoryBeforeScrape() {
  const mem = await getSystemMemory();
  if (!mem) return true;
  
  const freePercent = (mem.free / mem.total) * 100;
  const usedMB = (mem.used / 1024).toFixed(0);
  const totalMB = (mem.total / 1024).toFixed(0);
  
  console.log(`\n${C.cyan}[ram]${C.reset} RAM-Status: ${usedMB}MB / ${totalMB}MB (${freePercent.toFixed(1)}% free)`);
  
  if (freePercent < 10) {
    console.log(`\n${C.red}[ram]${C.reset} WARNING: Low RAM available (${freePercent.toFixed(1)}% free)!`);
    
    const processes = await getProcesses();
    const candidates = processes
      .filter(p => !isProcessWhitelisted(p.name))
      .filter(p => p.memKB > 100 * 1024)
      .sort((a, b) => b.memKB - a.memKB)
      .slice(0, 10);
    
    if (candidates.length > 0) {
      console.log(`${C.yellow}[ram]${C.reset} Top RAM-Fresser:`);
      for (const p of candidates) {
        const isGame = detectGame(p.name);
        const memMB = (p.memKB / 1024).toFixed(0);
        console.log(`  ${p.name} (PID ${p.pid}): ${memMB}MB${isGame ? ' [GAME]' : ''}`);
      }
      
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(`\n${C.yellow}[ram]${C.reset} Should these processes be terminated? (y/N): `, (a) => { rl.close(); resolve(a.trim().toLowerCase()); });
      });
      
      if (answer === 'y' || answer === 'yes') {
        for (const p of candidates) {
          await killProcess(p.pid, p.name);
        }
      }
    }
  }
  
  return true;
}


async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status === 429) {
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(2000);
    }
  }
  throw new Error("unreachable");
}

async function runPool(tasks, concurrency, label) {
  let activeCount = 0;
  let idx = 0;
  const results = new Array(tasks.length);
  const errors = [];

  await new Promise((resolve) => {
    const next = () => {
      try {
        while (!stopped && idx < tasks.length && activeCount < concurrency) {
          const t = tasks[idx++];
          activeCount++;
          Promise.resolve()
            .then(() => t.run())
            .then((r) => { results[t.index] = r; })
            .catch((e) => {
              errors.push(e);
              console.error(`[pool] ${label} task ${t.index} failed: ${e && e.message || e}`);
            })
            .finally(() => {
              activeCount--;
              try { next(); } catch (e) {
                console.error(`[pool] ${label} scheduler error: ${e && e.message || e}`);
                setTimeout(next, 0);
              }
            });
        }
      } catch (e) {
        console.error(`[pool] ${label} scheduler crashed: ${e && e.message || e}`);
        setTimeout(next, 50);
      }
      if (idx >= tasks.length && activeCount === 0) resolve();
    };
    next();
  });

  if (errors.length > 0) {
    console.error(`[pool] ${label}: ${errors.length} Error aufgetreten`);
  }
  return results.filter(Boolean);
}

let stopped = false;

let aniworldBrowser = null;
let stoBrowser = null;
let filmpalastBrowser = null;

async function getAniworldBrowser() {
  if (!aniworldBrowser) {
    const { chromium } = await import("playwright");
    aniworldBrowser = await chromium.launch({ args: ["--no-sandbox"] });
  }
  return aniworldBrowser;
}

async function getStoBrowser() {
  if (!stoBrowser) {
    const { chromium } = await import("playwright");
    stoBrowser = await chromium.launch({ args: ["--no-sandbox"] });
  }
  return stoBrowser;
}

async function getFilmpalastBrowser() {
  if (!filmpalastBrowser) {
    const { chromium } = await import("playwright");
    filmpalastBrowser = await chromium.launch({ 
      args: ["--no-sandbox"],
      ignoreHTTPSErrors: true,
    });
  }
  return filmpalastBrowser;
}

async function getAniworldCatalog() {
  info("[aniworld] Fetching anime catalog from /animes via Playwright...");
  const browser = await getAniworldBrowser();
  let context = null;
  let page = null;
  try {
    context = await browser.newContext();
    page = await context.newPage();
  } catch (e) {
    console.error(`[aniworld] Could not open Browser/Context: ${e.message}`);
    return [];
  }

  try {
    await page.goto(`${ANIWORLD_BASE}/animes`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 8; i++) {
      try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
      try { await page.waitForTimeout(800); } catch {}
    }
    const html = await page.content();

    const set = new Set();
    const re = /href="\/anime\/stream\/([^/"?]+)"/g;
    let m;
    while ((m = re.exec(html))) set.add(m[1]);

    const catalog = [...set];
    info(`[aniworld] ${catalog.length} Animes found via Playwright.`);
    return catalog;
  } finally {
    try { await context.close(); } catch {}
  }
}

const ANIWORLD_BASE = "https://aniworld.to";

function normalizeTitle(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getAnimeSeasons(html, slug) {
  const re = new RegExp(`/anime/stream/${slug}/staffel-(\\d+)`, "g");
  const set = new Set();
  let m;
  while ((m = re.exec(html))) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

function getAnimeEpisodes(html, slug, season) {
  const re = new RegExp(
    `/anime/stream/${slug}/staffel-${season}/episode-(\\d+)`,
    "g"
  );
  const set = new Set();
  let m;
  while ((m = re.exec(html))) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

function extractAnimeMeta(html) {
  const meta = (prop) =>
    (html.match(
      new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, "i")
    ) ||
      html.match(
        new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`, "i")
      ) ||
      [])[1] || null;
  const genres = [...html.matchAll(/itemprop="genre">([^<]+)</g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const mainGenre = (html.match(/data-main-genre="([^"]+)"/) || [])[1] || null;
  const title =
    (html.match(/<h1 itemprop="name"[^>]*>\s*<span>([^<]+)<\/span>/) || [])[1] ||
    meta("og:title");
  const cleanTitle = title ? title.replace(/\s*[-–—|:]\s*aniworld\.to$/i, "").replace(/\s*[-–—|:]\s*animeworld\.to$/i, "").trim() : null;
  const coverMatch = html.match(
    /class="seriesCoverBox"[^>]*>\s*<img[^>]*\sdata-src="([^"]+)"/
  );
  const cover = coverMatch ? ANIWORLD_BASE + coverMatch[1] : null;
  
  let description = null;
  const fullDescMatch = html.match(/data-full-description="([^"]+)"/);
  if (fullDescMatch) {
    description = fullDescMatch[1];
  }
  if (!description) {
    const seriDesMatch = html.match(/<p[^>]+class="seri_des"[^>]*>([^<]+)/);
    if (seriDesMatch) {
      description = seriDesMatch[1].trim();
    }
  }
  if (!description) {
    const itemDescMatch = html.match(/itemprop="description"[^>]*>([^<]+)</);
    if (itemDescMatch) {
      description = itemDescMatch[1].trim();
    }
  }
  if (!description) {
    description = meta("og:description");
  }

  const startYearMatch = html.match(/itemprop="startDate"[^>]*>.*?<a[^>]+href="[^"]*\/jahr\/(\d{4})[^"]*"[^>]*>(\d{4})<\/a>/);
  const endYearMatch = html.match(/itemprop="endDate"[^>]*>.*?<a[^>]+href="[^"]*\/jahr\/(\d{4})[^"]*"[^>]*>(\d{4})<\/a>/);
  const year = startYearMatch ? Number(startYearMatch[2]) : null;
  const yearEnd = endYearMatch ? Number(endYearMatch[2]) : null;

  const fskMatch = html.match(/data-fsk="(\d+)"/);
  const fsk = fskMatch ? Number(fskMatch[1]) : null;

  const imdbMatch = html.match(/data-imdb="(tt\d+)"/);
  const imdbId = imdbMatch ? imdbMatch[1] : null;
  const imdb = imdbId ? `https://www.imdb.com/title/${imdbId}/` : null;

  const ratingValueMatch = html.match(/itemprop="ratingValue"[^>]*>([^<]+)/);
  const ratingValue = ratingValueMatch ? Number(ratingValueMatch[1]) : null;
  const ratingCountMatch = html.match(/itemprop="ratingCount"[^>]*>([^<]+)/);
  const ratingCount = ratingCountMatch ? Number(ratingCountMatch[1].replace(/\./g, "")) : null;

  const status = yearEnd && yearEnd < new Date().getFullYear() ? "completed" : (yearEnd ? "ongoing" : "completed");

  return {
    title: cleanTitle ? cleanTitle.trim() : null,
    cover,
    description: description || null,
    category: mainGenre,
    genres: genres.length ? genres : null,
    year,
    yearEnd,
    status,
    fsk,
    imdb,
    imdbId,
    rating: ratingValue,
    votes: ratingCount ? String(ratingCount) : null,
  };
}

function extractAnimeEpisodeMeta(html, fallbackTitle) {
  let thumb = null;
  
  // Pattern 1
  const seriesCoverRe = /<img[^>]+data-src="(\/public\/img\/cover\/[^"]+)"[^>]+class="[^"]*seriesCoverBox[^"]*"/i;
  const seriesCoverMatch = html.match(seriesCoverRe);
  if (seriesCoverMatch) {
    thumb = ANIWORLD_BASE + seriesCoverMatch[1];
  }
  
  // Pattern 2
  if (!thumb) {
    const contentImgRe = /<div[^>]+class="[^"]*seriesContentBox[^"]*"[\s\S]*?<img[^>]+(?:data-src|src)="(\/public\/img\/cover\/[^"]+)"/i;
    const contentImgMatch = html.match(contentImgRe);
    if (contentImgMatch) {
      thumb = ANIWORLD_BASE + contentImgMatch[1];
    }
  }
  
  // Pattern 3
  if (!thumb) {
    const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
    if (ogImageMatch && !ogImageMatch[1].includes("facebook.jpg")) {
      thumb = ogImageMatch[1];
    }
  }

  let name = fallbackTitle || null;
  const titleRe = /<title>([^<]+)<\/title>/i;
  const titleMatch = html.match(titleRe);
  if (titleMatch) {
    const raw = titleMatch[1].trim();
    const clean = raw.replace(/\s*\|.*$/, "").trim();
    
    const epMatch = clean.match(/Episode\s+(\d+)/i);
    if (epMatch) {
      name = `Episode ${epMatch[1]}`;
    } else if (clean) {
      name = clean;
    }
  }
  
  return { name, thumb };
}

function extractAnimeHosterRows(html) {
  const rows = [];
  const langSet = new Set();
  const liRe = /<li\b[^>]*data-link-id="\d+"[\s\S]*?<\/li>/g;
  let li;
  while ((li = liRe.exec(html))) {
    const block = li[0];
    const id = (block.match(/data-link-id="(\d+)"/) || [])[1];
    const lk = Number((block.match(/data-lang-key="(\d+)"/) || [])[1] || 0);
    const icon = (block.match(/class="icon ([^"]+)"/i) || [])[1] || "?";
    const href = (block.match(/href="(\/redirect\/\d+)"/) || [])[1] || null;
    const playUrl = (block.match(/data-play-url="([^"]+)"/) || [])[1] || null;
    const provider = (block.match(/data-provider-name="([^"]+)"/) || [])[1] || icon;
    if (id && (href || playUrl)) {
      langSet.add(lk);
      rows.push({
        hoster: provider,
        langKey: lk,
        lang: { 1: "GerDub", 2: "EngSub", 3: "GerSub" }[lk] || `lang-${lk}`,
        redirectId: id,
        redirectPath: href || playUrl,
      });
    }
  }
  const allLanguages = [...langSet].map(lk => ({ 1: "GerDub", 2: "EngSub", 3: "GerSub" }[lk] || `lang-${lk}`));
  return { hosters: rows, allLanguages };
}

function cleanEpisodeName(name) {
  if (!name) return name;
  return name
    .replace(/\bS\d+\s*E\d+\b/gi, "")
    .replace(/\bS\d+EP\d+\b/gi, "")
    .replace(/\bEpisode\s*\d+\b/gi, "")
    .replace(/\s*[-–—:]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeAnime(slug) {
  const seriesHtml = await fetchText(`${ANIWORLD_BASE}/anime/stream/${slug}`);
  const seasons = getAnimeSeasons(seriesHtml, slug);
  const meta = extractAnimeMeta(seriesHtml);
  const out = { slug, ...meta, seasons: [], allLanguages: [] };
  const langSet = new Set();
  for (const s of seasons) {
    const seasonHtml = await fetchText(
      `${ANIWORLD_BASE}/anime/stream/${slug}/staffel-${s}`
    );
    const eps = getAnimeEpisodes(seasonHtml, slug, s);
    const seasonObj = { season: s, episodes: [] };
    for (const e of eps) {
      const epHtml = await fetchText(
        `${ANIWORLD_BASE}/anime/stream/${slug}/staffel-${s}/episode-${e}`
      );
      const { hosters, allLanguages } = extractAnimeHosterRows(epHtml);
      const { name, thumb } = extractAnimeEpisodeMeta(epHtml, `Episode ${e}`);
      seasonObj.episodes.push({ episode: e, name: cleanEpisodeName(name), thumb, hosters, addedAt: Date.now() });
      allLanguages.forEach(l => langSet.add(l));
      await sleep(DELAY_MS);
    }
    out.seasons.push(seasonObj);
  }
  out.allLanguages = [...langSet];
  return out;
}

const STO_BASE = "http://186.2.175.5";

function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return fase;
  return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url) || /\/media\/images\/(backdrop|poster)\//i.test(url);
}

async function scrapeStoWithPlaywright() {
  const browser = await getStoBrowser();
  let context = null;
  let page = null;
  try {
    context = await browser.newContext();
    page = await context.newPage();
  } catch (e) {
    console.error(`[S.to] Could not open Browser/Context: ${e.message}`);
    return { series: [] };
  }

  const result = { series: [] };

  try {
    info("[S.to] Fetching series list from /serien ...");
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(`${STO_BASE}/serien`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);
        const seriesHtml = await page.content();

        const seriesItems = [];
        const re = /<li class="series-item" data-search="([^"]*)">\s*<a href="\/serie\/([^"]+)">([^<]+)<\/a>/gi;
        let m;
        while ((m = re.exec(seriesHtml))) {
          seriesItems.push({
            slug: m[2],
            title: m[3].trim(),
            search: m[1],
          });
        }

        info(`[S.to] ${seriesItems.length} Series found`);
        result.series = seriesItems;
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        debugLog(`[S.to] Attempt ${attempt} failed, retry...`);
        await sleep(3000);
      }
    }
  } catch (e) {
    console.error(`[S.to] Series list failed: ${e && e.message || e}`);
  } finally {
    try { await context.close(); } catch {}
  }
  return result;
}

async function scrapeStoSeriesDetail(slug) {
  const browser = await getStoBrowser();
  let context = null;
  let page = null;
  try {
    context = await browser.newContext();
    page = await context.newPage();
  } catch (e) {
    console.error(`[S.to] Could not open Browser/Context for ${slug} cannot open: ${e.message}`);
    return null;
  }

  try {
    const seriesUrl = `${STO_BASE}/serie/${slug}`;
    debugLog(`[S.to] Scraping series: ${slug}`);
    
    let html = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(seriesUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
        html = await page.content();
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        debugLog(`[S.to] Attempt ${attempt} failed, retry...`);
        await sleep(1500);
      }
    }

    if (!html) throw new Error("Could not load series page");

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s*\|.*$/, "").trim() : slug;

    let cover = null;
    const backdropSlugMatch = html.match(
      /\/media\/images\/backdrop\/(?:orig|mobile|tablet|desktop|2x-desktop)\/([^?"')\s]+)/i
    );
    const backdropSlug = backdropSlugMatch ? backdropSlugMatch[1] : null;
    try {
      const domCover = await page.evaluate(() => {
        const sources = [...document.querySelectorAll('picture source')];
        const jpg = sources.find((s) => /format=jpg/.test(s.getAttribute('srcset') || ''));
        if (jpg) {
          const ss = jpg.getAttribute('srcset') || '';
          const m =
            ss.match(/\/media\/images\/backdrop\/2x-desktop\/[^?\s]+\?format=jpg/) ||
            ss.match(/\/media\/images\/backdrop\/desktop\/[^?\s]+\?format=jpg/);
          if (m) return m[0];
        }
        const img = document.querySelector('.backdrop-picture img, picture img, img[class*="backdrop"], img[class*="poster"]');
        if (img) {
          const src = img.getAttribute('src') || img.getAttribute('data-src') || null;
          if (src && !src.includes('provider') && !src.includes('voe.svg')) return src;
        }
        const allImgs = [...document.querySelectorAll('img')];
        const large = allImgs.find(i => {
          const s = i.getAttribute('src') || i.getAttribute('data-src') || '';
          return s.includes('/backdrop/') && !s.includes('provider') && !s.includes('voe.svg') && (s.includes('desktop') || s.includes('orig') || s.includes('2x'));
        });
        if (large) return large.getAttribute('src') || large.getAttribute('data-src');
        return null;
      });
      if (domCover && /format=jpg/.test(domCover)) {
        cover = isValidImageUrl(domCover) ? (domCover.startsWith('http') ? domCover : STO_BASE + domCover) : null;
      } else if (domCover && isValidImageUrl(domCover)) {
        cover = domCover.startsWith('http') ? domCover : STO_BASE + domCover;
      }
    } catch {}
    if (!cover && backdropSlug) {
      cover = isValidImageUrl(`${STO_BASE}/media/images/backdrop/desktop/${backdropSlug}?format=jpg`) ? `${STO_BASE}/media/images/backdrop/desktop/${backdropSlug}?format=jpg` : null;
    }
    if (!cover) {
      const og = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (og && og[1] && isValidImageUrl(og[1])) {
        let c = og[1];
        if (c.includes('/backdrop/orig/')) c = c.replace('/backdrop/orig/', '/backdrop/desktop/') + '?format=jpg';
        cover = c.startsWith('http') ? c : STO_BASE + c;
      }
    }
    if (!cover) {
      const cov = html.match(/\/media\/images\/backdrop\/[^"']+\.(?:jpg|png|webp)/i);
      if (cov) {
        const candidate = STO_BASE + cov[0];
        if (isValidImageUrl(candidate)) cover = candidate;
      }
    }

    const descMatch = html.match(/<meta name="description" content="([^"]+)"/i);
    const description = descMatch ? descMatch[1] : null;
    if (!description) {
      const descTextMatch = html.match(/<span class="description-text">([^<]+)<\/span>/);
      if (descTextMatch) description = descTextMatch[1].trim();
    }

    const genres = [];
    const genreRe = /<a[^>]+href="\/genre\/[^"]*"[^>]*class="[^"]*link-light[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let gm;
    while ((gm = genreRe.exec(html))) {
      genres.push(gm[1].trim());
    }
    if (genres.length === 0) {
      const altGenreRe = /<a[^>]+href="\/search\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
      let agm;
      while ((agm = altGenreRe.exec(html))) {
        const g = agm[1].trim();
        if (g && !genres.includes(g)) genres.push(g);
      }
    }

    const yearMatch = html.match(/<a[^>]+href="\/jahr\/(\d{4})"[^>]*class="[^"]*link-light[^"]*"[^>]*>(\d{4})<\/a>/i);
    const year = yearMatch ? Number(yearMatch[2]) : null;

    const yearRangeMatch = html.match(/(\d{4})\s*-\s*(\d{4})/);
    const yearEnd = yearRangeMatch ? Number(yearRangeMatch[2]) : null;

    const fskMatch = html.match(/FSK\s*(\d+|[A-Za-z]+)/i);
    const fsk = fskMatch ? fskMatch[1].trim() : null;

    const imdbMatch = html.match(/<a[^>]+href="https?:\/\/(?:www\.)?imdb\.com\/title\/([^/"]+)"[^>]*class="[^"]*text-muted[^"]*"[^>]*>.*?IMDb.*?<\/a>/i);
    const imdbId = imdbMatch ? imdbMatch[1] : null;
    const imdb = imdbId ? `https://www.imdb.com/title/${imdbId}/` : null;

    const ratingCountMatch = html.match(/(\d+)\s*ratings/i);
    const ratingCount = ratingCountMatch ? ratingCountMatch[1] : null;

    const status = yearEnd && yearEnd < new Date().getFullYear() ? "completed" : (yearEnd && yearEnd >= new Date().getFullYear() ? "ongoing" : "unknown");

    const countryMatch = html.match(/<li class="series-group">\s*<strong[^>]*>Land:<\/strong>\s*([\s\S]*?)<\/li>/i);
    let country = null;
    if (countryMatch) {
      const countryLinkRe = /<a[^>]+href="\/land\/[^"]*"[^>]*class="[^"]*link-light[^"]*"[^>]*>([^<]+)<\/a>/i;
      const cm = countryMatch[1].match(countryLinkRe);
      if (cm) country = cm[1].trim();
    }

    const cast = [];
    const castRe = /<a[^>]+href="\/schauspieler\/[^"]*"[^>]*class="[^"]*link-light[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let castM;
    while ((castM = castRe.exec(html))) {
      cast.push(castM[1].trim());
    }

    const directors = [];
    const directorRe = /<a[^>]+href="\/regisseur\/[^"]*"[^>]*class="[^"]*link-light[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let dirM;
    while ((dirM = directorRe.exec(html))) {
      directors.push(dirM[1].trim());
    }

    const seasonLinks = [];
    const seasonRe = /<a href="\/serie\/[^/]+\/staffel-(\d+)"[^>]*class="[^"]*season[^"]*"[^>]*>(\d+)<\/a>/gi;
    let sm;
    while ((sm = seasonRe.exec(html))) {
      seasonLinks.push({ season: Number(sm[1]), label: sm[2] });
    }

    if (seasonLinks.length === 0) {
      const altRe = /href="\/serie\/[^/]+\/staffel-(\d+)"/gi;
      let am;
      const seasonNums = new Set();
      while ((am = altRe.exec(html))) {
        seasonNums.add(Number(am[1]));
      }
      seasonNums.forEach(s => seasonLinks.push({ season: s, label: String(s) }));
    }

    const seasons = [];
    const langSet = new Set();

    for (const sl of seasonLinks) {
      debugLog(`[S.to]   Season ${sl.season} ...`);
      const seasonUrl = `${STO_BASE}/serie/${slug}/staffel-${sl.season}`;
      
      for (let seasonAttempt = 1; seasonAttempt <= 3; seasonAttempt++) {
        try {
          await page.goto(seasonUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(1000);
          break;
        } catch (e) {
          if (seasonAttempt === 3) throw e;
          await sleep(2000);
        }
      }
      
      const seasonHtml = await page.content();

      const episodes = [];
      const epRe = /<tr class="episode-row[^"]*"[^>]*onclick="window\.location='\/serie\/[^/]+\/staffel-(\d+)\/episode-(\d+)'"[^>]*>/gi;
      const episodeUrls = [];
      let em;
      while ((em = epRe.exec(seasonHtml))) {
        const epSeason = Number(em[1]);
        const epNum = Number(em[2]);
        episodeUrls.push({ epSeason, epNum, block: em[0] });
      }

      for (let epIdx = 0; epIdx < episodeUrls.length; epIdx++) {
        const { epSeason, epNum, block } = episodeUrls[epIdx];
        
        const titleGerMatch = block.match(/class="episode-title-ger"[\s\S]*?title="([^"]+)"/);
        const titleEngMatch = block.match(/class="episode-title-eng"[\s\S]*?title="([^"]+)"/);
        let epName = titleGerMatch ? titleGerMatch[1] : (titleEngMatch ? titleEngMatch[1] : null);

        const thumbMatch = block.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*episode[^"]*"/i);
        let thumb = thumbMatch ? thumbMatch[1] : null;
        if (!thumb) {
          const thumbMatch2 = block.match(/data-src="([^"]+)"[^>]+class="[^"]*episode[^"]*"/i);
          if (thumbMatch2) thumb = thumbMatch2[1];
        }
        
        const episodeUrl = `${STO_BASE}/serie/${slug}/staffel-${epSeason}/episode-${epNum}`;
        debugLog(`[S.to]     Episode ${epNum} -> ${episodeUrl}`);
        
        const hosters = [];
        for (let epAttempt = 1; epAttempt <= 3; epAttempt++) {
          try {
            await page.goto(episodeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(4000);

            try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
            await page.waitForTimeout(2000);
            
            if (!epName) {
              const nameFromDom = await page.evaluate(() => {
                const selectors = [
                  'h2',
                  '.episode-title-ger',
                  '.episode-title-eng',
                  '.episode-title',
                  '[class*="episode"] h2',
                  '[class*="episode"] .title',
                  'h1',
                  '.title'
                ];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el && el.textContent?.trim()) {
                    return el.textContent.trim();
                  }
                }
                return null;
              });
              if (nameFromDom) epName = nameFromDom;
            }
            
            if (!thumb) {
              const thumbFromDom = await page.evaluate(() => {
                const selectors = [
                  'img[class*="backdrop"]',
                  'img[class*="cover"]',
                  '.content img',
                  'article img',
                  'img[class*="poster"]',
                  '.episode-image img',
                  '.episode-poster img'
                ];
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el) {
                    const src = el.getAttribute('src') || el.getAttribute('data-src');
                    if (src && !src.includes('provider') && !src.includes('voe.svg') && !src.includes('doodstream') && !src.includes('filemoon') && !src.includes('vidmoly')) {
                      return src;
                    }
                  }
                }
                return null;
              });
              if (thumbFromDom) thumb = thumbFromDom;
            }
            
            const episodePath = `/serie/${slug}/staffel-${epSeason}/episode-${epNum}`;

            const extracted = await page.evaluate(() => {
              const results = [];
              const buttons = document.querySelectorAll('button[data-link-id][data-play-url][data-provider-name]');
              buttons.forEach(btn => {
                const linkId = btn.getAttribute('data-link-id') || '';
                const playUrl = btn.getAttribute('data-play-url') || '';
                const provider = btn.getAttribute('data-provider-name') || '';
                const langId = btn.getAttribute('data-language-id') || btn.getAttribute('data-lang') || '1';
                const langLabel = btn.getAttribute('data-language-label') || '';
                if (linkId || playUrl) {
                  results.push({
                    hoster: provider,
                    langKey: parseInt(langId) || 1,
                    langLabel: langLabel,
                    redirectId: linkId,
                    redirectPath: playUrl,
                  });
                }
              });
              return results;
            });
            
            if (extracted && extracted.length > 0) {
              extracted.forEach(h => {
                const langMap = { 1: "GerDub", 2: "EngSub", 3: "GerSub" };
                const lang = h.langLabel && h.langLabel.trim() ? h.langLabel.trim() : (langMap[h.langKey] || `lang-${h.langKey}`);
                hosters.push({
                  hoster: h.hoster,
                  langKey: h.langKey,
                  lang,
                  redirectId: h.redirectId,
                  redirectPath: h.redirectPath,
                  episodePath,
                });
                langSet.add(h.langKey);
              });
            }
            
            if (hosters.length === 0) {
              const epHtml = await page.content();
              const hosterRe = /data-link-id="(\d+)"[^>]*data-play-url="([^"]+)"[^>]*data-provider-name="([^"]+)"[^>]*data-language-id="(\d+)"/gi;
              let hm;
              while ((hm = hosterRe.exec(epHtml))) {
                const langId = Number(hm[4]);
                const langMap = { 1: "GerDub", 2: "EngSub", 3: "GerSub" };
                const lang = langMap[langId] || `lang-${langId}`;
                hosters.push({
                  hoster: hm[3],
                  langKey: langId,
                  lang,
                  redirectId: hm[1],
                  redirectPath: hm[2],
                  episodePath,
                });
                langSet.add(langId);
              }
            }
            
            break;
          } catch (e) {
            if (epAttempt === 3) {
              debugLog(`[S.to]     Episode ${epNum}: Could not load hosters: ${e.message}`);
            }
            await sleep(2000);
          }
        }
        
        if (!epName) {
          epName = `Episode ${epNum}`;
        }

        if ((!thumb || thumb.startsWith('data:image/gif') || thumb.includes('provider') ||
            thumb.includes('voe.svg') || thumb.includes('avif') || thumb.includes('/mobile/')) && cover) {
          thumb = cover;
        }

        episodes.push({ episode: epNum, name: cleanEpisodeName(epName), thumb, description: description || null, hosters, addedAt: Date.now() });
      }

      if (episodes.length > 0) {
        seasons.push({ season: sl.season, episodes });
      }
    }

    try { await context.close(); } catch {}
    const stoAllLanguages = [...langSet].map(lk => ({ 1: "GerDub", 2: "EngSub", 3: "GerSub" }[lk] || `lang-${lk}`));
    return {
      slug,
      source: "sto",
      title,
      cover,
      description,
      genres: genres.length ? genres : null,
      year,
      yearEnd,
      country,
      cast: cast.length ? cast : null,
      directors: directors.length ? directors : null,
      fsk,
      imdb,
      ratingCount,
      status,
      seasons,
      allLanguages: stoAllLanguages,
      addedAt: Date.now(),
    };
  } catch (e) {
    console.error(`[S.to] Error on ${slug}: ${e && e.message || e}`);
    return null;
  } finally {
    try { await context.close(); } catch {}
  }
}

const FILMPALAST_BASE = "http://filmpalast.to";

function slugify(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getFilmpalastStreamLinks(streamSlug) {
  const browser = await getFilmpalastBrowser();
  let context = null;
  let page = null;
  try {
    context = await browser.newContext();
    page = await context.newPage();
  } catch (e) {
    console.error(`[filmpalast] Could not open Browser/Context: ${e.message}`);
    return null;
  }
  
  try {
    await page.goto(`${FILMPALAST_BASE}/stream/${streamSlug}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    
    const links = [];

    const blockRe = /<li class="streamPlayBtn[^"]*">([\s\S]*?)<\/li>/g;
    let bm;
    while ((bm = blockRe.exec(html))) {
      const block = bm[1];
      const playerUrl = (block.match(/data-player-url="([^"]+)"/) || [])[1] || null;
      const href = (block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i) || [])[1] || null;
      const embed = playerUrl || href;
      const text = (block.match(/class="button[^"]*"[^>]*>([^<]+)<\/a>/i) || [])[1]?.trim() || "";
      const rawLangKey = (bm[0].match(/data-lang-key="(\d+)"/) || block.match(/data-lang-key="(\d+)"/) || ["1"])[1];
      if (embed) links.push({ href: embed, text, langKey: Number(rawLangKey) });
    }

    const hosterRe = /<p class="hostName">([^<]+)<\/p>/gi;
    const hosters = [];
    let hm;
    while ((hm = hosterRe.exec(html))) {
      hosters.push(hm[1].trim());
    }

    const hosterObjs = links.map((l, i) => ({
      hoster: hosters[i] || l.text || "Hoster",
      langKey: l.langKey || 1,
      lang: { 1: "Ger", 2: "Eng" }[l.langKey || 1] || `lang-${l.langKey || 1}`,
      redirectPath: l.href,
      embed: l.href,
    }));
    const fpAllLanguages = [...new Set(links.map(l => ({ 1: "Ger", 2: "Eng" }[l.langKey || 1] || `lang-${l.langKey || 1}`)))];

    const playerUrlMatch = html.match(/data-player-url="([^"]+)"/);
    const playerUrl = playerUrlMatch ? playerUrlMatch[1] : (links[0] ? links[0].href : null);

    const titleMatch = html.match(/<h2[^>]*class="[^"]*rb[^"]*"[^>]*>\s*([^<]+)\s*<\/h2>/);
    let title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) {
      const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/i);
      if (ogTitle) title = ogTitle[1].trim();
    }
    if (title) {
      title = title.replace(/\s*[-–—|:]\s*filmpalast\.to$/i, "").replace(/\s*[-–—|:]\s*filmpalast$/i, "").trim();
    }

    let cover = null;
    const cov240 = html.match(/\/files\/movies\/240\/[^"'\\]+\.(?:jpg|png)/i);
    const covAny = html.match(/\/files\/movies\/[^"'\\]+\.(?:jpg|png)/i);
    const covPath = (cov240 || covAny || [])[0];
    if (covPath) cover = FILMPALAST_BASE + covPath;

    let description = null;
    const descMatch = html.match(/<span class="hidden ">([^<]+)<\/span>/);
    if (descMatch) {
      description = descMatch[1].trim();
    } else {
      const descMatch2 = html.match(/itemprop="description"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i);
      if (descMatch2) {
        description = descMatch2[1].trim();
      }
    }

    const genres = [];
    const genreRe = /<a[^>]+href="\/search\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let gm;
    while ((gm = genreRe.exec(html))) {
      const g = gm[1].trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    const yearMatch = html.match(/Ver&ouml;ffentlicht:\s*(\d{4})/i) || html.match(/Veroeffentlicht:\s*(\d{4})/i) || html.match(/releaseYear["\s:]+(\d{4})/i) || html.match(/"releaseYear":\s*(\d{4})/);
    const year = yearMatch ? Number(yearMatch[1]) : null;

    const durMatch = html.match(/duration:\s*<em>(\d+)\s*Min\.<\/em>/i);
    const duration = durMatch ? Number(durMatch[1]) : null;

    const ratingMatch = html.match(/<span class="average">([\d.]+)<\/span>/);
    const rating = ratingMatch ? Number(ratingMatch[1]) : null;
    const votesMatch = html.match(/<span class="votes">([^<]+)<\/span>/);
    const votes = votesMatch ? votesMatch[1].trim() : null;
    const imdbMatch = html.match(/Imdb:\s*([\d.]+)\/10/i);
    const imdb = imdbMatch ? Number(imdbMatch[1]) : null;

    const idMatch = html.match(/id="viewID"[^>]*data-id="(\d+)"/);
    const id = idMatch ? idMatch[1] : null;

    return {
      slug: streamSlug,
      title,
      cover,
      description,
      genres: genres.length ? genres : null,
      year,
      duration,
      rating,
      votes,
      imdb,
      id,
      playerUrl,
      hosters: hosterObjs,
      hosterNames: hosters,
      links,
      allLanguages: fpAllLanguages,
      addedAt: Date.now(),
    };
  } finally {
    await context.close();
  }
}

async function getFilmpalastCatalog() {
  info("[filmpalast] Fetching catalog from / via Playwright...");
  const browser = await getFilmpalastBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    await page.goto(`${FILMPALAST_BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    
    const pageTitle = await page.title();
    const bodyLength = await page.evaluate(() => document.body.innerText.length);
    debugLog(`[filmpalast] Start page loaded: "${pageTitle}" (${bodyLength} characters)`);
    
    let lastCount = 0;
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      const currentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/stream/"]').length);
      if (currentCount === lastCount) break;
      lastCount = currentCount;
    }
    
    const items = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/stream/"]').forEach(el => {
        const href = el.getAttribute('href') || '';
        const match = href.match(/\/stream\/([^/]+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          results.push({ slug: match[1] });
        }
      });
      return results;
    });
    
    info(`[filmpalast] ${items.length} entries found on start page.`);
    
    const genreLinks = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/genre/"]')]
        .map((a) => a.getAttribute('href'))
        .filter(Boolean))]
    );
    info(`[filmpalast] ${genreLinks.length} genre links found.`);
    const seenSlugs = new Set(items.map((i) => i.slug));

    for (let gIdx = 0; gIdx < genreLinks.length; gIdx++) {
      const g = genreLinks[gIdx];
      try {
        debugLog(`[filmpalast]   Crawling genre ${gIdx + 1}/${genreLinks.length}: ${g}`);
        const genreUrl = g.startsWith('http') ? g : FILMPALAST_BASE + g;
        await page.goto(genreUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1500);
        
        let gLastCount = 0;
        for (let i = 0; i < 8; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(700);
          const gCurrentCount = await page.evaluate(() => document.querySelectorAll('a[href*="/stream/"]').length);
          if (gCurrentCount === gLastCount) break;
          gLastCount = gCurrentCount;
        }
        
        const gItems = await page.evaluate(() => {
          const out = [];
          const s = new Set();
          document.querySelectorAll('a[href*="/stream/"]').forEach((el) => {
            const m = (el.getAttribute('href') || '').match(/\/stream\/([^/]+)/);
            if (m && !s.has(m[1])) { s.add(m[1]); out.push({ slug: m[1] }); }
          });
          return out;
        });
        
        let added = 0;
        for (const it of gItems) {
          if (!seenSlugs.has(it.slug) && !/-s\d+e\d+$/i.test(it.slug)) {
            seenSlugs.add(it.slug);
            items.push(it);
            added++;
          }
        }
        if (added > 0) {
          info(`[filmpalast]   ${g}: +${added} new entries (${gItems.length} total on page)`);
        } else {
          info(`[filmpalast]   ${g}: no new entries (${gItems.length} on page, already seen or series)`);
        }
        
        await sleep(500);
      } catch (e) {
        info(`[filmpalast]   ${g}: Error - ${e.message}`);
      }
    }

    info(`[filmpalast] ${items.length} entries found via Playwright.`);
    return items;
  } finally {
    await context.close();
  }
}

async function loadCatalogMap() {
  const map = new Map();
  if (!existsSync(CATALOG_FILE)) return map;
  const txt = await readFile(CATALOG_FILE, "utf8");
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      const key = `${rec.source}:${rec.slug}`;
      map.set(key, rec);
    } catch {}
  }
  return map;
}

async function appendCatalogEntry(rec) {
  try {
    const line = JSON.stringify(rec);
    await appendFile(CATALOG_FILE, line + "\n", "utf8");
  } catch (e) {
    console.error(`[catalog] write failed: ${e && e.message || e}`);
    throw e;
  }
}

async function appendCatalogEntryIfChanged(oldRec, newRec, mergedRec) {
  const mergedStr = JSON.stringify(mergedRec);
  const oldStr = JSON.stringify(oldRec);
  if (mergedStr !== oldStr) {
    try {
      await appendFile(CATALOG_FILE, mergedStr + "\n", "utf8");
    } catch (e) {
      console.error(`[catalog] write-if-changed failed: ${e && e.message || e}`);
      throw e;
    }
    return true;
  }
  return fase;
}

async function appendDoneEntry(key) {
  try {
    await appendFile(DONE_FILE, key + "\n", "utf8");
  } catch (e) {
    console.warn(`[done] write failed: ${e && e.message || e}`);
  }
}

async function loadDone() {
  if (!existsSync(DONE_FILE)) return new Set();
  const txt = await readFile(DONE_FILE, "utf8");
  return new Set(txt.split("\n").filter(Boolean));
}

async function saveCheckpoint(source, processed, total, currentSlug) {
  try {
    const checkpoint = {
      source,
      processed,
      total,
      currentSlug,
      timestamp: Date.now(),
    };
    await writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint), "utf8");
  } catch (e) {
    console.warn(`[checkpoint] save failed: ${e && e.message || e}`);
  }
}

async function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  try {
    const txt = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function normalizeForDedup(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findDuplicate(map, source, title, slug) {
  const normTitle = normalizeForDedup(title);
  const normSlug = normalizeForDedup(slug);

  for (const [key, rec] of map) {
    if (rec.source === source) continue;
    const recNormTitle = normalizeForDedup(rec.title);
    const recNormSlug = normalizeForDedup(rec.slug);

    if (normTitle && recNormTitle && (normTitle === recNormTitle || normSlug === recNormSlug)) {
      return { key, rec };
    }
  }
  return null;
}

function mergeAnimeRecords(oldRec, newRec) {
  const merged = { ...newRec };
  if (!merged.source && oldRec && oldRec.source) {
    merged.source = oldRec.source;
  }
  merged.seasons = Array.isArray(newRec.seasons) ? [...newRec.seasons] : [];
  let changed = false;
  const oldSeasons = new Map((oldRec.seasons || []).map((s) => [Number(s.season), s]));
  const newSeasons = new Map((newRec.seasons || []).map((s) => [Number(s.season), s]));
  for (const [seasonNum, newSeason] of newSeasons) {
    const oldSeason = oldSeasons.get(seasonNum);
    if (!oldSeason) {
      merged.seasons.push(newSeason);
      changed = true;
      continue;
    }
    const oldEps = new Map((oldSeason.episodes || []).map((e) => [Number(e.episode), e]));
    const mergedEps = (newSeason.episodes || []).map((ep) => {
      const existing = oldEps.get(Number(ep.episode));
      if (!existing) {
        changed = true;
        return ep;
      }
      const hasNewMeta = ep.name !== existing.name || ep.thumb !== existing.thumb;
      const hasNewHosters = ep.hosters && ep.hosters.length > 0;
      const mergedEp = {
        episode: ep.episode,
        name: ep.name || existing.name,
        thumb: ep.thumb || existing.thumb,
        hosters: hasNewHosters ? ep.hosters : existing.hosters,
        local: existing.local || null,
      };
      if (hasNewMeta || hasNewHosters) changed = true;
      return mergedEp;
    });
    merged.seasons.push({ season: seasonNum, episodes: mergedEps });
  }
  for (const [seasonNum, oldSeason] of oldSeasons) {
    if (!newSeasons.has(seasonNum)) {
      merged.seasons.push(oldSeason);
    }
  }
  merged.seasons.sort((a, b) => a.season - b.season);
  const metaChanged = merged.title !== oldRec.title || merged.cover !== oldRec.cover || merged.description !== oldRec.description;
  if (metaChanged) changed = true;
  return { record: merged, changed };
}

function groupChaptersIntoArcs(chapters) {
  if (!chapters.length) return [];
  const arcs = [];
  let currentArc = [chapters[0]];
  for (let i = 1; i < chapters.length; i++) {
    const prev = chapters[i - 1];
    const curr = chapters[i];
    const prevNum = parseFloat(prev.number) || 0;
    const currNum = parseFloat(curr.number) || 0;
    if (currNum - prevNum > 1.5) {
      arcs.push(currentArc);
      currentArc = [curr];
    } else {
      currentArc.push(curr);
    }
  }
  arcs.push(currentArc);
  return arcs;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (!process.argv.includes('--retry') && !process.argv.includes('--errors')) {
    await cleanupProcesses();
    await checkMemoryBeforeScrape();
  }

  const existing = await loadCatalogMap();
  const done = await loadDone();
  const checkpoint = await loadCheckpoint();

  const monitorStarted = !process.argv.includes('--retry') && !process.argv.includes('--errors');
  let monitorPromise = null;
  if (monitorStarted) {
    monitorPromise = monitorMemory();
  }

  if (SOURCES.includes("aniworld")) {
    info("========== ANIWORLD (Anime) ==========");
    let catalog = [];
    try {
      catalog = await getAniworldCatalog();
    } catch (e) {
      err(`[aniworld] Could not load catalog: ${e.message}`);
    }

    if (Number.isFinite(LIMIT)) catalog = catalog.slice(0, LIMIT);

    info(`[aniworld] ${catalog.length} Animes found.`);

    const tasks = [];
    for (let i = 0; i < catalog.length; i++) {
      const slug = catalog[i];
      const key = `aniworld:${slug}`;
      if (!BENCHMARK && !FORCE && done.has(key)) {
        info(`[aniworld] ${slug}: skipped (already processed)`);
        continue;
      }
      tasks.push({
        index: tasks.length,
        run: async () => {
          try {
            await saveCheckpoint("aniworld", i, catalog.length, slug);
            benchStartTime(slug);
            const result = await scrapeWithMemoryGuard(() => scrapeAnime(slug), `aniworld:${slug}`);
            benchEndTime(slug);
            if (result) {
              const oldRec = existing.get(key);
              let recordToSave;
              if (oldRec) {
                const { record: merged, changed } = mergeAnimeRecords(oldRec, result);
                recordToSave = merged;
                const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
                const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
                if (added > oldTotal) ok(`[aniworld] ${slug}: +${added - oldTotal} new episodes (${added} total)`);
                else if (changed) info(`[aniworld] ${slug}: Metadata updated`);
                else info(`[aniworld] ${slug}: no changes`);
              } else {
                recordToSave = { ...result, source: "aniworld", addedAt: Date.now() };
                const total = result.seasons.reduce((n, s) => n + s.episodes.length, 0);
                ok(`[aniworld] ${slug}: NEW - ${result.seasons.length} Seasons, ${total} episodes`);
              }
              await appendCatalogEntry(recordToSave);
              existing.delete(key);
              done.add(key);
              await appendDoneEntry(key);
            }
          } catch (e) {
            console.error(`[aniworld] Task error ${slug}: ${e && e.message || e}`);
          }
        },
      });
    }

    if (tasks.length > 0) {
      info(`[aniworld] Starting worker pool (${CONCURRENCY} parallel, ${tasks.length} tasks)...`);
      await runPool(tasks, CONCURRENCY, "aniworld");
    }
  }

  if (SOURCES.includes("sto")) {
    info("========== S.TO (Series) ==========");
    let stoSeries = [];

    try {
      const stoResult = await scrapeStoWithPlaywright();
      stoSeries = stoResult.series || [];
    } catch (e) {
      err(`[S.to] Error fetching der Seriesliste: ${e.message}`);
    }

    if (Number.isFinite(LIMIT)) stoSeries = stoSeries.slice(0, LIMIT);

    info(`[S.to] ${stoSeries.length} Series found.`);

    const tasks = [];
    for (let i = 0; i < stoSeries.length; i++) {
      const s = stoSeries[i];
      const key = `sto:${s.slug}`;
      if (!BENCHMARK && !FORCE && done.has(key)) {
        info(`[S.to] ${s.slug}: skipped (already processed)`);
        continue;
      }
      tasks.push({
        index: tasks.length,
        run: async () => {
          await saveCheckpoint("sto", i, stoSeries.length, s.slug);
          benchStartTime(s.slug);
          const result = await scrapeWithMemoryGuard(async () => {
            try {
              return await scrapeStoSeriesDetail(s.slug);
            } catch (e) {
              console.error(`[S.to] Worker-Error on ${s.slug}: ${e && e.message || e}`);
              return null;
            }
          }, `sto:${s.slug}`);
          benchEndTime(s.slug);
          if (result) {
            const dup = findDuplicate(existing, "sto", result.title, result.slug);
            if (dup) {
              info(`[S.to] Duplicate detected: "${result.title}" already exists as "${dup.rec.title}" (${dup.key})`);
            }

            const oldRec = existing.get(key);
            let recordToSave;
            if (oldRec) {
              const { record: merged, changed } = mergeAnimeRecords(oldRec, result);
              recordToSave = merged;
              const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
              const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
              if (added > oldTotal) ok(`[S.to] ${result.title}: +${added - oldTotal} new episodes (${added} total)`);
              else if (changed) info(`[S.to] ${result.title}: Metadata updated`);
              else info(`[S.to] ${result.title}: no changes`);
            } else {
              recordToSave = result;
              const total = result.seasons.reduce((n, s) => n + s.episodes.length, 0);
              ok(`[S.to] ${result.title}: NEW - ${result.seasons.length} Seasons, ${total} episodes`);
            }
            await appendCatalogEntry(recordToSave);
            existing.delete(key);
            done.add(key);
            await appendDoneEntry(key);
          }
        },
      });
    }

    if (tasks.length > 0) {
      info(`[S.to] Starting worker pool (${CONCURRENCY} parallel, ${tasks.length} tasks)...`);
      await runPool(tasks, CONCURRENCY, "sto");
    }
  }

  if (SOURCES.includes("filmpalast")) {
    info("========== FILMPALAST (Filme/Series) ==========");
    let fpItems = [];

    try {
      const fpCatalog = await getFilmpalastCatalog();
      fpItems = fpCatalog || [];
    } catch (e) {
      err(`[filmpalast] Error fetching des Catalogs: ${e.message}`);
    }

    if (Number.isFinite(LIMIT)) fpItems = fpItems.slice(0, LIMIT);

    info(`[filmpalast] ${fpItems.length} entries found.`);

    const seriesMap = new Map();
    const movieItems = [];

    for (const item of fpItems) {
      const seMatch = item.slug.match(/-s(\d+)e(\d+)$/i);
      if (seMatch) {
        const seriesSlug = item.slug.replace(/-s\d+e\d+$/i, "");
        if (!seriesMap.has(seriesSlug)) {
          seriesMap.set(seriesSlug, { slug: seriesSlug, episodes: [] });
        }
        seriesMap.get(seriesSlug).episodes.push(item);
      } else {
        movieItems.push(item);
      }
    }

    const movieTasks = [];
    for (let i = 0; i < movieItems.length; i++) {
      const item = movieItems[i];
      const key = `filmpalast:${item.slug}`;
      if (!BENCHMARK && !FORCE && done.has(key)) {
        info(`[filmpalast] ${item.slug}: skipped (already processed)`);
        continue;
      }
      movieTasks.push({
        index: movieTasks.length,
        run: async () => {
          try {
            await saveCheckpoint("filmpalast", i, movieItems.length, item.slug);
            benchStartTime(item.slug);
            const result = await scrapeWithMemoryGuard(() => getFilmpalastStreamLinks(item.slug), `filmpalast:${item.slug}`);
            benchEndTime(item.slug);
            if (result) {
              result.type = "movie";
              result.addedAt = Date.now();

              const dup = findDuplicate(existing, "filmpalast", result.title, result.slug);
              if (dup) {
                info(`[filmpalast] Duplicate detected: "${result.title}" already exists as "${dup.rec.title}" (${dup.key})`);
              }

              const oldRec = existing.get(key);
              let recordToSave;
              if (oldRec) {
                recordToSave = { ...result, source: "filmpalast" };
                info(`[filmpalast] ${result.title}: updated`);
              } else {
                recordToSave = { ...result, source: "filmpalast" };
                ok(`[filmpalast] ${result.title}: NEU`);
              }
              await appendCatalogEntry(recordToSave);
              existing.delete(key);
              done.add(key);
              await appendDoneEntry(key);
            }
          } catch (e) {
            console.error(`[filmpalast] Task error ${item.slug}: ${e && e.message || e}`);
          }
        },
      });
    }

    if (movieTasks.length > 0) {
      info(`[filmpalast] Starting worker pool fuer Filme (${CONCURRENCY} parallel, ${movieTasks.length} tasks)...`);
      await runPool(movieTasks, CONCURRENCY, "filmpalast-movies");
    }

    const seriesEntries = [...seriesMap.entries()];
    const seriesTasks = [];
    for (let i = 0; i < seriesEntries.length; i++) {
      const [seriesSlug, seriesData] = seriesEntries[i];
      const key = `filmpalast:${seriesSlug}`;
      if (!BENCHMARK && !FORCE && done.has(key)) {
        info(`[filmpalast] Series ${seriesSlug}: skipped (already processed)`);
        continue;
      }
      seriesTasks.push({
        index: seriesTasks.length,
        run: async () => {
          await saveCheckpoint("filmpalast", i, seriesEntries.length, seriesSlug);
          benchStartTime(seriesSlug);

          const seasonsMap = new Map();
          let seriesResult = null;
          const langSet = new Set();
          for (const epItem of seriesData.episodes) {
            const seMatch = epItem.slug.match(/-s(\d+)e(\d+)$/i);
            if (!seMatch) continue;
            const seasonNum = Number(seMatch[1]);
            const episodeNum = Number(seMatch[2]);

            if (!seasonsMap.has(seasonNum)) {
              seasonsMap.set(seasonNum, { season: seasonNum, episodes: [] });
            }
            const epResult = await getFilmpalastStreamLinks(epItem.slug);
            if (!seriesResult && epResult) seriesResult = epResult;
            if (epResult && epResult.allLanguages) {
              epResult.allLanguages.forEach(l => langSet.add(l));
            }
            seasonsMap.get(seasonNum).episodes.push({
              episode: episodeNum,
              name: `${seriesResult ? seriesResult.title : seriesSlug} - Episode ${episodeNum}`,
              thumb: seriesResult ? seriesResult.cover : null,
              addedAt: Date.now(),
              hosters: epResult ? (epResult.hosters || []) : [],
              links: epResult ? (epResult.links || []) : [],
            });
          }

          if (!seriesResult) {
            info(`[filmpalast] Series ${seriesSlug}: keine episodes-Daten`);
            return;
          }

          const seasons = [...seasonsMap.values()].sort((a, b) => a.season - b.season);

          const record = {
            slug: seriesSlug,
            source: "filmpalast",
            title: seriesResult.title,
            cover: seriesResult.cover,
            description: seriesResult.description,
            genres: seriesResult.genres,
            year: seriesResult.year,
            duration: seriesResult.duration,
            rating: seriesResult.rating,
            votes: seriesResult.votes,
            imdb: seriesResult.imdb,
            type: "series",
            seasons,
            allLanguages: [...langSet],
            addedAt: Date.now(),
          };

          const dup = findDuplicate(existing, "filmpalast", record.title, record.slug);
          if (dup) {
            info(`[filmpalast] Duplicate detected: "${record.title}" already exists as "${dup.rec.title}" (${dup.key})`);
          }

          const oldRec = existing.get(key);
          let recordToSave;
          if (oldRec) {
            const { record: merged, changed } = mergeAnimeRecords(oldRec, record);
            recordToSave = merged;
            const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
            const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
            if (added > oldTotal) ok(`[filmpalast] ${record.title}: +${added - oldTotal} new episodes (${added} total)`);
            else if (changed) info(`[filmpalast] ${record.title}: Metadata updated`);
            else info(`[filmpalast] ${record.title}: no changes`);
          } else {
            recordToSave = record;
            const total = seasons.reduce((n, s) => n + s.episodes.length, 0);
            ok(`[filmpalast] ${record.title}: NEW - ${seasons.length} Seasons, ${total} episodes`);
          }
          await appendCatalogEntry(recordToSave);
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
          benchEndTime(seriesSlug);
        },
      });
    }

    if (seriesTasks.length > 0) {
      info(`[filmpalast] Starting worker pool fuer Series (${CONCURRENCY} parallel, ${seriesTasks.length} tasks)...`);
      await runPool(seriesTasks, CONCURRENCY, "filmpalast-series");
    }
  }

  if (SOURCES.some(s => MANGA_SOURCES[s])) {
    for (const mangaSourceKey of Object.keys(MANGA_SOURCES)) {
      if (!SOURCES.includes(mangaSourceKey)) continue;
      const src = MANGA_SOURCES[mangaSourceKey];
      info(`========== ${src.name.toUpperCase()} (Manga) ==========`);
      let mangaCatalog = [];
      try {
        mangaCatalog = await src.catalog();
      } catch (e) {
        err(`[${mangaSourceKey}] Could not load catalog: ${e.message}`);
      }
      if (Number.isFinite(LIMIT)) mangaCatalog = mangaCatalog.slice(0, LIMIT);
      info(`[${mangaSourceKey}] ${mangaCatalog.length} Manga found.`);
      for (const manga of mangaCatalog) {
        const key = `${mangaSourceKey}:${manga.slug}`;
        if (!BENCHMARK && !FORCE && done.has(key)) {
          info(`[${mangaSourceKey}] ${manga.slug}: skipped (already processed)`);
          continue;
        }
        try {
          const chapters = await src.chapters(manga.slug);
          const grouped = groupChaptersIntoArcs(chapters);
          const seasons = grouped.map((arc, idx) => ({
            season: idx + 1,
            episodes: arc.map((ch, i) => ({
              episode: ch.number || i + 1,
              name: ch.title || `Chapter ${ch.number || i + 1}`,
              thumb: manga.cover,
              addedAt: Date.now(),
              hosters: [],
              links: [],
              chapterId: ch.id
            }))
          }));
          const record = {
            ...manga,
            seasons: seasons.length ? seasons : [],
            addedAt: Date.now()
          };
          const oldRec = existing.get(key);
          const dup = findDuplicate(existing, mangaSourceKey, manga.title, manga.slug);
          if (dup) {
            info(`[${mangaSourceKey}] Duplicate detected: "${manga.title}" already exists as "${dup.rec.title}" (${dup.key})`);
          }
          let recordToSave;
          let changed = false;
          const mergeTarget = oldRec || dup?.rec;
          if (mergeTarget) {
            const merged = mergeAnimeRecords(mergeTarget, record);
            recordToSave = merged.record;
            changed = merged.changed;
            if (changed) info(`[${mangaSourceKey}] ${manga.title}: updated`);
            else info(`[${mangaSourceKey}] ${manga.title}: no changes`);
          } else {
            recordToSave = record;
            changed = true;
            ok(`[${mangaSourceKey}] ${manga.title}: NEU`);
          }
          const saved = await appendCatalogEntryIfChanged(oldRec, record, recordToSave);
          if (saved) {
            existing.delete(key);
            done.add(key);
            await appendDoneEntry(key);
          }
        } catch (e) {
          err(`[${mangaSourceKey}] ${manga.slug}: Error - ${e.message}`);
        }
      }
    }
  }
  const additionalSources = [
    { key: "megakino", targetSource: "filmpalast" },
    { key: "kinox", targetSource: "filmpalast" },
    { key: "burningseries", targetSource: "sto" }
  ];
  for (const { key: sourceKey, targetSource } of additionalSources) {
    if (!SOURCES.includes(sourceKey)) continue;
    const src = LIVE_TV_SOURCES[sourceKey] || MANGA_SOURCES[sourceKey];
    if (!src || !src.catalog) continue;
    info(`========== ${src.name.toUpperCase()} (as ${targetSource}) ==========`);
    let catalog = [];
    try {
      catalog = await src.catalog();
    } catch (e) {
      err(`[${sourceKey}] Could not load catalog: ${e.message}`);
    }
    if (Number.isFinite(LIMIT)) catalog = catalog.slice(0, LIMIT);
    info(`[${sourceKey}] ${catalog.length} entries found.`);
    for (const item of catalog) {
      const key = `${targetSource}:${item.slug}`;
      if (!BENCHMARK && !FORCE && done.has(key)) {
        info(`[${sourceKey}] ${item.slug}: skipped (already processed)`);
        continue;
      }
      try {
        const record = {
          ...item,
          source: targetSource,
          addedAt: Date.now()
        };
        const oldRec = existing.get(key);
        let recordToSave;
        let changed = false;
        if (oldRec) {
          const merged = mergeAnimeRecords(oldRec, record);
          recordToSave = merged.record;
          changed = merged.changed;
          if (changed) info(`[${sourceKey}] ${item.title}: updated`);
          else info(`[${sourceKey}] ${item.title}: no changes`);
        } else {
          recordToSave = record;
          changed = true;
          ok(`[${sourceKey}] ${item.title}: NEU`);
        }
        const saved = await appendCatalogEntryIfChanged(oldRec, record, recordToSave);
        if (saved) {
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
        }
      } catch (e) {
        err(`[${sourceKey}] ${item.slug}: Error - ${e.message}`);
      }
    }
  }

  const total = [...existing.keys()].length + done.size;
  info(`Done. Catalog: ${total} entries in ${CATALOG_FILE}`);

  if (existsSync(CHECKPOINT_FILE)) {
    try { await rm(CHECKPOINT_FILE); } catch {}
  }

  if (!process.argv.includes('--retry') && !process.argv.includes('--errors')) {
    await retryFailedEntries();
  }

  if (stoBrowser) {
    try { await stoBrowser.close(); } catch {}
  }
  if (aniworldBrowser) {
    try { await aniworldBrowser.close(); } catch {}
  }
  if (filmpalastBrowser) {
    try { await filmpalastBrowser.close(); } catch {}
  }

  summarizeErrors();
  benchSummary();
  
  stopped = true;
  if (monitorPromise) {
    try { await monitorPromise; } catch {}
  }
}

const isMain = process.argv[1] && decodeURIComponent(import.meta.url.replace("file://", "").replace(/\\/g, "/")).endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    if (stoBrowser) {
      stoBrowser.close().catch(() => {});
    }
    if (aniworldBrowser) {
      aniworldBrowser.close().catch(() => {});
    }
    if (filmpalastBrowser) {
      filmpalastBrowser.close().catch(() => {});
    }
    process.exit(1);
  });
}
