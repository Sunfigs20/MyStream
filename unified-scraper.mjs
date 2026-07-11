import { writeFile, appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tiny debug switch, flip to true if something looks weird
const _dbg = false;

// Memory guard with auto-pause/resume
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
    console.warn(`[MEMORY] HIGH: ${heapUsedMB}MB used. Pausing for ${MEMORY_PAUSE_DURATION / 1000}s to let memory settle...`);
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

async function scrapeWithMemoryGuard(scrapeFn) {
  await checkMemory();
  return await scrapeFn();
}

// ===================== CONFIG =====================
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DELAY_MS = Number(process.env.DELAY_MS || 100);
const CONCURRENCY = Number(process.env.CONCURRENCY || 5);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const FORCE = process.argv.includes("--force");
const OUT_DIR = "out";
const CATALOG_FILE = `${OUT_DIR}/unified_catalog.jsonl`;
const DONE_FILE = `${OUT_DIR}/unified_done.txt`;
const CHECKPOINT_FILE = `${OUT_DIR}/unified_checkpoint.json`;

const SOURCE = (process.env.SOURCE || "all").toLowerCase();
const SOURCES = SOURCE === "all" ? ["aniworld", "sto", "filmpalast"] : [SOURCE];

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};
const log = (...a) => console.log(...a, C.reset);
const ok = (m) => log(`${C.green}${C.bold}[ok]${C.reset} ${m}`);
const err = (m) => log(`${C.red}${C.bold}[err]${C.reset} ${m}`);
const info = (m) => log(`${C.cyan}[scraper]${C.reset} ${m}`);

// ===================== FETCH =====================
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

// ===================== PLAYWRIGHT HELPERS =====================
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
    filmpalastBrowser = await chromium.launch({ args: ["--no-sandbox"] });
  }
  return filmpalastBrowser;
}

// ===================== ANIWORLD =====================
const ANIWORLD_BASE = "https://aniworld.to";

async function getAniworldCatalog() {
  info("[aniworld] Grabbing anime catalog from /animes via Playwright...");
  const browser = await getAniworldBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${ANIWORLD_BASE}/animes`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
    }
    const html = await page.content();

    const set = new Set();
    const re = /href="\/anime\/stream\/([^/"?]+)"/g;
    let m;
    while ((m = re.exec(html))) set.add(m[1]);

    const catalog = [...set];
    info(`[aniworld] found ${catalog.length} animes via Playwright.`);
    return catalog;
  } finally {
    await context.close();
  }
}

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
    if (description) {
      description = description
        .replace(/\s*weitere Staffeln komplett als gratis HD-Stream mehrsprachig online ansehen\.\s*✓\s*100% Kostenlos\s*✓\s*Online\s*✓\s*1000\+ Animes.*$/i, '')
        .replace(/\s*Jetzt Episode \d+ Staffel \d+ von[^&]+& weitere Anime-Folgen komplett in bester HD Qualität online als Stream\.\s*✓\s*100% Kostenlos\s*✓\s*Online\s*✓\s*Anime VOD.*$/i, '')
        .replace(/\s*Anime VOD.*$/i, '')
        .replace(/\s+$/g, '')
        .trim();
    }
  }

  return {
    title: title ? title.trim() : null,
    cover,
    description: description || null,
    category: mainGenre,
    genres: genres.length ? genres : null,
  };
}

function extractAnimeEpisodeMeta(html, fallbackTitle) {
  let thumb = null;

  const seriesCoverRe = /<img[^>]+data-src="(\/public\/img\/cover\/[^"]+)"[^>]+class="[^"]*seriesCoverBox[^"]*"/i;
  const seriesCoverMatch = html.match(seriesCoverRe);
  if (seriesCoverMatch) {
    thumb = ANIWORLD_BASE + seriesCoverMatch[1];
  }

  if (!thumb) {
    const contentImgRe = /<div[^>]+class="[^"]*seriesContentBox[^"]*"[\s\S]*?<img[^>]+(?:data-src|src)="(\/public\/img\/cover\/[^"]+)"/i;
    const contentImgMatch = html.match(contentImgRe);
    if (contentImgMatch) {
      thumb = ANIWORLD_BASE + contentImgMatch[1];
    }
  }

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
  const liRe = /<li\b[^>]*data-link-id="\d+"[\s\S]*?<\/li>/g;
  let li;
  while ((li = liRe.exec(html))) {
    const block = li[0];
    const id = (block.match(/data-link-id="(\d+)"/) || [])[1];
    const lk = Number((block.match(/data-lang-key="(\d+)"/) || [])[1] || 0);
    const icon = (block.match(/class="icon ([^"]+)"/) || [])[1] || "?";
    const href = (block.match(/href="(\/redirect\/\d+)"/) || [])[1] || null;
    if (id && href) {
      rows.push({
        hoster: icon,
        langKey: lk,
        lang: { 1: "GerDub", 2: "EngSub", 3: "GerSub" }[lk] || `lang-${lk}`,
        redirectId: id,
        redirectPath: href,
      });
    }
  }
  return rows;
}

async function scrapeAnime(slug) {
  const seriesHtml = await fetchText(`${ANIWORLD_BASE}/anime/stream/${slug}`);
  const seasons = getAnimeSeasons(seriesHtml, slug);
  const meta = extractAnimeMeta(seriesHtml);
  const out = { slug, ...meta, seasons: [] };
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
      const hosters = extractAnimeHosterRows(epHtml);
      const { name, thumb } = extractAnimeEpisodeMeta(epHtml, `Episode ${e}`);
      seasonObj.episodes.push({ episode: e, name, thumb, hosters, addedAt: Date.now() });
      await sleep(DELAY_MS);
    }
    out.seasons.push(seasonObj);
  }
  return out;
}
// ===================== S.TO =====================
const STO_BASE = "http://186.2.175.5";

async function scrapeStoWithPlaywright() {
  const browser = await getStoBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  const result = { series: [] };

  try {
    info("[S.to] Grabbing series list from /serien ...");

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

        info(`[S.to] found ${seriesItems.length} series`);
        result.series = seriesItems;

        if (LIMIT !== Infinity) {
          info(`[S.to] LIMIT active: only processing first ${LIMIT} series`);
        }
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        info(`[S.to] attempt ${attempt} failed, retrying...`);
        await sleep(3000);
      }
    }
  } catch (e) {
    err(`[S.to] error fetching series list: ${e.message}`);
  }

  await context.close();
  return result;
}

//the funvtion is too long but it works so leaving it for now (CHANGE LATER)
async function scrapeStoSeriesDetail(slug) {
  const browser = await getStoBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const seriesUrl = `${STO_BASE}/serie/${slug}`;
    info(`[S.to] scraping series: ${slug}`);

    let html = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(seriesUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
        html = await page.content();
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        info(`[S.to] attempt ${attempt} failed, retrying...`);
        await sleep(1500);
      }
    }

    if (!html) throw new Error("could not load series page");

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
        cover = domCover.startsWith('http') ? domCover : STO_BASE + domCover;
      } else if (domCover && !domCover.includes('provider') && !domCover.includes('voe.svg')) {
        cover = domCover.startsWith('http') ? domCover : STO_BASE + domCover;
      }
    } catch {}
    if (!cover && backdropSlug) {
      cover = `${STO_BASE}/media/images/backdrop/desktop/${backdropSlug}?format=jpg`;
    }
    if (!cover) {
      const og = html.match(/<meta property="og:image" content="([^"]+)"/);
      if (og && og[1]) {
        let c = og[1];
        if (c.includes('/backdrop/orig/')) c = c.replace('/backdrop/orig/', '/backdrop/desktop/') + '?format=jpg';
        cover = c.startsWith('http') ? c : STO_BASE + c;
      }
    }
    if (!cover) {
      const cov = html.match(/\/media\/images\/backdrop\/[^"']+\.(?:jpg|png|webp)/i);
      if (cov) cover = STO_BASE + cov[0];
    }

    const descMatch = html.match(/<meta name="description" content="([^"]+)"/i);
    const description = descMatch ? descMatch[1] : null;

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

    for (const sl of seasonLinks) {
      info(`[S.to]   season ${sl.season} ...`);
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
      let em;
      while ((em = epRe.exec(seasonHtml))) {
        const epSeason = Number(em[1]);
        const epNum = Number(em[2]);

        const epBlock = em[0];
        const titleGerMatch = epBlock.match(/class="episode-title-ger"[\s\S]*?title="([^"]+)"/);
        const titleEngMatch = epBlock.match(/class="episode-title-eng"[\s\S]*?title="([^"]+)"/);
        let epName = titleGerMatch ? titleGerMatch[1] : (titleEngMatch ? titleEngMatch[1] : null);

        const thumbMatch = epBlock.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*episode[^"]*"/i);
        let thumb = thumbMatch ? thumbMatch[1] : null;
        if (!thumb) {
          const thumbMatch2 = epBlock.match(/data-src="([^"]+)"[^>]+class="[^"]*episode[^"]*"/i);
          if (thumbMatch2) thumb = thumbMatch2[1];
        }

        const episodeUrl = `${STO_BASE}/serie/${slug}/staffel-${epSeason}/episode-${epNum}`;
        info(`[S.to]     episode ${epNum} -> ${episodeUrl}`);

        const hosters = [];
        for (let epAttempt = 1; epAttempt <= 3; epAttempt++) {
          try {
            await page.goto(episodeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(3000);

            try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
            await page.waitForTimeout(1500);

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

              document.querySelectorAll('[data-link-id], .streamPlayBtn, .hoster-item, [data-hoster], a[href*="/redirect/"], [data-provider-name], .hostername').forEach(el => {
                const linkId = el.getAttribute('data-link-id') || el.getAttribute('data-id') || '';
                const playUrl = el.getAttribute('data-play-url') || el.getAttribute('data-url') || el.getAttribute('href') || '';
                const provider = el.getAttribute('data-provider-name') || el.getAttribute('data-hoster') || el.textContent?.trim() || '';
                const langId = el.getAttribute('data-language-id') || el.getAttribute('data-lang') || '1';

                if (linkId || playUrl) {
                  results.push({
                    hoster: provider,
                    langKey: parseInt(langId) || 1,
                    redirectId: linkId,
                    redirectPath: playUrl ? playUrl : (linkId ? `/redirect/${linkId}` : ''),
                  });
                }
              });

              return results;
            });

              if (extracted && extracted.length > 0) {
                extracted.forEach(h => {
                  const langMap = { 1: "GerDub", 2: "EngSub", 3: "GerSub" };
                  hosters.push({
                    hoster: h.hoster,
                    langKey: h.langKey,
                    lang: langMap[h.langKey] || `lang-${h.langKey}`,
                    redirectId: h.redirectId,
                    redirectPath: h.redirectPath,
                    episodePath,
                  });
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
              }
            }

            break;
          } catch (e) {
            if (epAttempt === 3) {
              info(`[S.to]     episode ${epNum}: could not load hosters: ${e.message}`);
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

        episodes.push({ episode: epNum, name: epName, thumb, description: description || null, hosters, addedAt: Date.now() });

        await page.goto(seasonUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(300);
      }

      if (episodes.length > 0) {
        seasons.push({ season: sl.season, episodes });
      }
    }

    await context.close();
    return {
      slug,
      source: "sto",
      title,
      cover,
      description,
      genres: genres.length ? genres : null,
      year,
      country,
      cast: cast.length ? cast : null,
      directors: directors.length ? directors : null,
      seasons,
      addedAt: Date.now(),
    };
  } catch (e) {
    await context.close();
    throw e;
  }
}
// ===================== FILMPALAST =====================
const FILMPALAST_BASE = "https://filmpalast.to";

function slugify(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getFilmpalastStreamLinks(streamSlug) {
  const browser = await getFilmpalastBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

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
      if (embed) links.push({ href: embed, text });
    }

    const hosterRe = /<p class="hostName">([^<]+)<\/p>/gi;
    const hosters = [];
    let hm;
    while ((hm = hosterRe.exec(html))) {
      hosters.push(hm[1].trim());
    }

    const hosterObjs = links.map((l, i) => ({
      hoster: hosters[i] || l.text || "Hoster",
      lang: "Ger",
      langKey: 1,
      redirectPath: l.href,
      embed: l.href,
    }));

    const playerUrlMatch = html.match(/data-player-url="([^"]+)"/);
    const playerUrl = playerUrlMatch ? playerUrlMatch[1] : (links[0] ? links[0].href : null);

    const titleMatch = html.match(/<h2[^>]*class="[^"]*rb[^"]*"[^>]*>\s*([^<]+)\s*<\/h2>/);
    const title = titleMatch ? titleMatch[1].trim() : null;

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

    const yearMatch = html.match(/Ver&ouml;ffentlicht:\s*(\d{4})/i);
    const year = yearMatch ? Number(yearMatch[1]) : null;

    const durMatch = html.match(/Spielzeit:\s*<em>(\d+)\s*Min\.<\/em>/i);
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
      addedAt: Date.now(),
    };
  } finally {
    await context.close();
  }
}

// todo maybe: split the catalog scraping into its own module later
async function getFilmpalastCatalog() {
  info("[filmpalast] Grabbing catalog from / via Playwright...");
  const browser = await getFilmpalastBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${FILMPALAST_BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

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

    const genreLinks = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('a[href*="/genre/"]')]
        .map((a) => a.getAttribute('href'))
        .filter(Boolean))]
    );
    const seenSlugs = new Set(items.map((i) => i.slug));
    for (const g of genreLinks.slice(0, 10)) {
      try {
        await page.goto(FILMPALAST_BASE + g, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1200);
        const gItems = await page.evaluate(() => {
          const out = [];
          const s = new Set();
          document.querySelectorAll('a[href*="/stream/"]').forEach((el) => {
            const m = (el.getAttribute('href') || '').match(/\/stream\/([^/]+)/);
            if (m && !s.has(m[1])) { s.add(m[1]); out.push({ slug: m[1] }); }
          });
          return out;
        });
        for (const it of gItems) {
          if (!seenSlugs.has(it.slug) && !/-s\d+e\d+$/i.test(it.slug)) {
            seenSlugs.add(it.slug);
            items.push(it);
          }
        }
      } catch {}
    }

    info(`[filmpalast] found ${items.length} entries via Playwright.`);
    return items;
  } finally {
    await context.close();
  }
}
// ===================== CATALOG MANAGEMENT =====================
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
  const line = JSON.stringify(rec);
  await appendFile(CATALOG_FILE, line + "\n", "utf8");
}

async function appendDoneEntry(key) {
  await appendFile(DONE_FILE, key + "\n", "utf8");
}

async function loadDone() {
  if (!existsSync(DONE_FILE)) return new Set();
  const txt = await readFile(DONE_FILE, "utf8");
  return new Set(txt.split("\n").filter(Boolean));
}

async function saveCheckpoint(source, processed, total, currentSlug) {
  const checkpoint = {
    source,
    processed,
    total,
    currentSlug,
    timestamp: Date.now(),
  };
  await writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint), "utf8");
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
    if (rec.source == source) continue;
    const recNormTitle = normalizeForDedup(rec.title);
    const recNormSlug = normalizeForDedup(rec.slug);

    if (normTitle && recNormTitle && (normTitle === recNormTitle || normSlug === recNormSlug)) {
      return { key, rec };
    }
  }
  return null;
}

function mergeAnimeRecords(oldRec, newRec) {
  // we only keep the 5 most recent seasons, the rest get dropped
  const merged = { ...newRec };
  merged.seasons = [];
  let changed = false;
  const oldSeasons = new Map(oldRec.seasons.map((s) => [Number(s.season), s]));
  const newSeasons = new Map(newRec.seasons.map((s) => [Number(s.season), s]));
  for (const [seasonNum, newSeason] of newSeasons) {
    const oldSeason = oldSeasons.get(seasonNum);
    if (!oldSeason) {
      merged.seasons.push(newSeason);
      changed = true;
      continue;
    }
    const oldEps = new Map(oldSeason.episodes.map((e) => [Number(e.episode), e]));
    const mergedEps = newSeason.episodes.map((ep) => {
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

// ===================== MAIN =====================
async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const _runId = Math.random().toString(36).slice(2);

  const existing = await loadCatalogMap();
  const done = await loadDone();
  const checkpoint = await loadCheckpoint();

  if (SOURCES.includes("aniworld")) {
    info("========== ANIWORLD (Anime) ==========");
    let catalog = [];
    try {
      catalog = await getAniworldCatalog();
    } catch (e) {
      err(`[aniworld] could not load catalog: ${e.message}`);
    }

    if (Number.isFinite(LIMIT)) catalog = catalog.slice(0, LIMIT);

    info(`[aniworld] found ${catalog.length} animes.`);

    for (let i = 0; i < catalog.length; i++) {
      const slug = catalog[i];
      const key = `aniworld:${slug}`;
      const _done = i + 1;
      if (_dbg) console.log(`[aniworld] progress ${_done + 1}/${catalog.length}`);
      if (done.has(key)) {
        info(`[aniworld] ${slug}: skipped (already processed)`);
        continue;
      }
      try {
        await saveCheckpoint("aniworld", i, catalog.length, slug);
        const result = await scrapeWithMemoryGuard(() => scrapeAnime(slug), `aniworld:${slug}`);
        if (result) {
          const oldRec = existing.get(key);
          let recordToSave;
          if (oldRec) {
            const { record: merged, changed } = mergeAnimeRecords(oldRec, result);
            recordToSave = merged;
            const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
            const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
            if (added > oldTotal) ok(`[aniworld] ${slug}: +${added - oldTotal} new episodes (${added} total)`);
            else if (changed) info(`[aniworld] ${slug}: metadata updated`);
            else info(`[aniworld] ${slug}: no changes`);
          } else {
            recordToSave = { ...result, source: "aniworld", addedAt: Date.now() };
            const total = result.seasons.reduce((n, s) => n + s.episodes.length, 0);
            ok(`[aniworld] ${slug}: NEW - ${result.seasons.length} seasons, ${total} episodes`);
          }
          await appendCatalogEntry(recordToSave);
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
        }
      } catch (e) {
        err(`[aniworld] ${slug}: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  if (SOURCES.includes("sto")) {
    info("========== S.TO (Series) ==========");
    let stoSeries = [];

    try {
      const stoResult = await scrapeStoWithPlaywright();
      stoSeries = stoResult.series || [];
    } catch (e) {
      err(`[S.to] error fetching series list: ${e.message}`);
    }

    if (Number.isFinite(LIMIT)) stoSeries = stoSeries.slice(0, LIMIT);

    info(`[S.to] found ${stoSeries.length} series.`);

    for (let i = 0; i < stoSeries.length; i++) {
      const s = stoSeries[i];
      const key = `sto:${s.slug}`;
      if (done.has(key)) {
        info(`[S.to] ${s.slug}: skipped (already processed)`);
        continue;
      }
      try {
        await saveCheckpoint("sto", i, stoSeries.length, s.slug);
        const result = await scrapeWithMemoryGuard(() => scrapeStoSeriesDetail(s.slug), `sto:${s.slug}`);
        if (result) {
          const dup = findDuplicate(existing, "sto", result.title, result.slug);
          if (dup) {
            info(`[S.to] DUPLICATE detected: "${result.title}" already exists as "${dup.rec.title}" (${dup.key})`);
          }

          const oldRec = existing.get(key);
          let recordToSave;
          if (oldRec) {
            const { record: merged, changed } = mergeAnimeRecords(oldRec, result);
            recordToSave = merged;
            const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
            const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
            if (added > oldTotal) ok(`[S.to] ${result.title}: +${added - oldTotal} new episodes (${added} total)`);
            else if (changed) info(`[S.to] ${result.title}: metadata updated`);
            else info(`[S.to] ${result.title}: no changes`);
          } else {
            recordToSave = result;
            const total = result.seasons.reduce((n, s) => n + s.episodes.length, 0);
            ok(`[S.to] ${result.title}: NEW - ${result.seasons.length} seasons, ${total} episodes`);
          }
          await appendCatalogEntry(recordToSave);
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
        }
      } catch (e) {
        err(`[S.to] ${s.slug}: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  if (SOURCES.includes("filmpalast")) {
    info("========== FILMPALAST (Movies/Series) ==========");
    let fpItems = [];

    try {
      const fpCatalog = await getFilmpalastCatalog();
      fpItems = fpCatalog || [];
    } catch (e) {
      err(`[filmpalast] error fetching catalog: ${e.message}`);
    }

    fpItems = fpItems.slice();

    if (Number.isFinite(LIMIT)) fpItems = fpItems.slice(0, LIMIT);

    info(`[filmpalast] found ${fpItems.length} entries.`);

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

    for (let i = 0; i < movieItems.length; i++) {
      const item = movieItems[i];
      const key = `filmpalast:${item.slug}`;
      if (done.has(key)) {
        info(`[filmpalast] ${item.slug}: skipped (already processed)`);
        continue;
      }
      try {
        await saveCheckpoint("filmpalast", i, movieItems.length, item.slug);
        const result = await scrapeWithMemoryGuard(() => getFilmpalastStreamLinks(item.slug), `filmpalast:${item.slug}`);
        if (result) {
          result.type = "movie";
          result.addedAt = Date.now();

          const dup = findDuplicate(existing, "filmpalast", result.title, result.slug);
          if (dup) {
            info(`[filmpalast] DUPLICATE detected: "${result.title}" already exists as "${dup.rec.title}" (${dup.key})`);
          }

          const oldRec = existing.get(key);
          let recordToSave;
          if (oldRec) {
            recordToSave = { ...result, source: "filmpalast" };
            info(`[filmpalast] ${result.title}: updated`);
          } else {
            recordToSave = { ...result, source: "filmpalast" };
            ok(`[filmpalast] ${result.title}: NEW`);
          }
          await appendCatalogEntry(recordToSave);
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
        }
      } catch (e) {
        err(`[filmpalast] ${item.slug}: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }

    const series_entries = [...seriesMap.entries()];
    for (let i = 0; i < series_entries.length; i++) {
      const [seriesSlug, seriesData] = series_entries[i];
      const key = `filmpalast:${seriesSlug}`;
      if (done.has(key)) {
        info(`[filmpalast] series ${seriesSlug}: skipped (already processed)`);
        continue;
      }
      try {
        await saveCheckpoint("filmpalast", i, series_entries.length, seriesSlug);

        const seasonsMap = new Map();
        let seriesResult = null;
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
          seasonsMap.get(seasonNum).episodes.push({
            episode: episodeNum,
            name: `${seriesResult ? seriesResult.title : seriesSlug} - Episode ${episodeNum}`,
            addedAt: Date.now(),
            hosters: epResult ? (epResult.hosters || []) : [],
            links: epResult ? (epResult.links || []) : [],
          });
        }

        if (!seriesResult) {
          info(`[filmpalast] series ${seriesSlug}: no episode data`);
          continue;
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
          addedAt: Date.now(),
        };

          const dup = findDuplicate(existing, "filmpalast", record.title, record.slug);
          if (dup) {
            info(`[filmpalast] DUPLICATE detected: "${record.title}" already exists as "${dup.rec.title}" (${dup.key})`);
          }

          const oldRec = existing.get(key);
          let recordToSave;
          if (oldRec) {
            const { record: merged, changed } = mergeAnimeRecords(oldRec, record);
            recordToSave = merged;
            const added = merged.seasons.reduce((n, s) => n + s.episodes.length, 0);
            const oldTotal = oldRec.seasons.reduce((n, s) => n + s.episodes.length, 0);
            if (added > oldTotal) ok(`[filmpalast] ${record.title}: +${added - oldTotal} new episodes (${added} total)`);
            else if (changed) info(`[filmpalast] ${record.title}: metadata updated`);
            else info(`[filmpalast] ${record.title}: no changes`);
          } else {
            recordToSave = record;
            const total = seasons.reduce((n, s) => n + s.episodes.length, 0);
            ok(`[filmpalast] ${record.title}: NEW - ${seasons.length} seasons, ${total} episodes`);
          }
          await appendCatalogEntry(recordToSave);
          existing.delete(key);
          done.add(key);
          await appendDoneEntry(key);
      } catch (e) {
        err(`[filmpalast] series ${seriesSlug}: ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  const total = [...existing.keys()].length + done.size;
  info(`Done. Catalog: ${total} entries in ${CATALOG_FILE}`);

  if (existsSync(CHECKPOINT_FILE)) {
    try { await rm(CHECKPOINT_FILE); } catch {}
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
}

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
