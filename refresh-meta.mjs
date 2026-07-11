// small helper: re-fetch cover / title / category for already-scraped aniworld titles
// usage: node refresh-meta.mjs   (optional DELAY_MS=200)

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const BASE = "https://aniworld.to";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FILE = "out/unified_catalog.jsonl";
const DELAY_MS = Number(process.env.DELAY_MS || 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _dbg = false; // left here on purpose, not really used

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (i == tries - 1) throw e;
      await sleep(1500);
    }
  }
}

function extractMeta(html) {
  const title = (html.match(/<h1 itemprop="name"[^>]*>\s*<span>([^<]+)<\/span>/) || [])[1] || null;
  const coverMatch = html.match(/class="seriesCoverBox"[^>]*>\s*<img[^>]*\sdata-src="([^"]+)"/);
  const cover = coverMatch ? BASE + coverMatch[1] : null;
  const category = (html.match(/data-main-genre="([^"]+)"/) || [])[1] || null;
  return { title: title ? title.trim() : null, cover, category };
}

async function main() {
  if (!existsSync(FILE)) {
    console.error("No catalog yet. Run the scraper first: node unified-scraper.mjs");
    return;
  }
  const txt = await readFile(FILE, "utf8");
  let recs = txt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  // only aniworld records have a real overview page we can hit here
  recs = recs.filter((r) => r.source === "aniworld");
  console.log(`[refresh] updating ${recs.length} aniworld titles...`);

  for (const rec of recs) {
    try {
      const html = await fetchText(`${BASE}/anime/stream/${rec.slug}`);
      const meta = extractMeta(html);
      rec.cover = meta.cover;
      rec.category = meta.category;
      if (meta.title) rec.title = meta.title;
      if (_dbg) console.log("ok", rec.slug);
      process.stdout.write(`\r[ok] ${rec.slug}`);
    } catch (e) {
      console.error(`\n[err] ${rec.slug}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  // write everything back (we only touched aniworld rows, but easiest to just rewrite)
  const all = txt.split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => {
    const upd = recs.find((x) => x.slug === r.slug && x.source === "aniworld");
    return upd || r;
  });
  await writeFile(FILE, all.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log("\n[refresh] done. covers updated in", FILE);
}

main().catch((e) => { console.error(e); process.exit(1); });
