const view = document.getElementById("view");
const search = document.getElementById("search");
const genresBar = document.getElementById("genres");
const topbar = document.getElementById("topbar");
const searchbox = document.getElementById("searchbox");
const searchToggle = document.getElementById("searchToggle");
const shuffleBtn = document.getElementById("shuffleBtn");
const debugBtn = document.getElementById("debugBtn");
const modalRoot = document.getElementById("modalRoot");
const playerRoot = document.getElementById("playerRoot");
const toastEl = document.getElementById("toast");

const PROGRESS_KEY = "mystream_progress_v1";
const MYLIST_KEY = "mystream_mylist_v1";

let allCatalog = [];
let progress = loadProgress();
let myList = loadMyList();
let activeVid = null;
let activeNextEpisode = null;
let activePlayerShowControls = null;
let appDebug = false;
let renderCacheKey = "";
let renderCacheHtml = "";

const MAX_LOBBY_SIZE = 5;
const WT_NAME_KEY = "mystream_wt_name";
const WT_SESSION_KEY = "mystream_wt_session_v1";
let pendingJoinLobbyId = null;

function loadWtName() {
    try { return localStorage.getItem(WT_NAME_KEY) || ""; } catch { return ""; }
}
function saveWtName(name) {
    try { localStorage.setItem(WT_NAME_KEY, name); } catch {}
}
function loadWtSession() {
    try { return JSON.parse(localStorage.getItem(WT_SESSION_KEY)) || null; } catch { return null; }
}
function saveWtSession(data) {
    try { localStorage.setItem(WT_SESSION_KEY, JSON.stringify(data)); } catch {}
}
function clearWtSession() {
    try { localStorage.removeItem(WT_SESSION_KEY); } catch {}
}

async function waitForActiveVid(timeoutMs = 8000) {
    const start = Date.now();
    while (!activeVid && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 200));
    }
    return activeVid;
}

async function setDebug(on) {
    appDebug = on;
    try { await fetch("/api/debug", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debug: on }) }); } catch {}
}
function debugLog(...args) {
    if (!appDebug) return;
    console.log("[debug]", ...args);
}

function wtSend(msg) {
    const wt = window.watchPartyManager;
    if (wt && wt.ws && wt.ws.readyState === WebSocket.OPEN && wt.isHost) {
        wt.ws.send(JSON.stringify(msg));
    }
}

let state = {
    route: "home",
    activeGenre: "all",
    record: null,
    season: null,
    episode: null,
    currentSource: "all",
    currentLangFilter: "all",
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 20.6 7.4 19.2 6z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 10h2v7h-2zm0-4h2v2h-2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" fill="none"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h4l6 8 6 8h4M4 20h4l3-4M14 4h6v6M20 4l-6.5 8.5M14 20h6v-6"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4M3 11V7a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v4a4 4 0 0 1-4 4H3"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};
const I18N = {
    en: {
        "doc.title": "MYSTREAM",
        "nav.home": "Home",
        "nav.live": "Live TV",
        "nav.manga": "Manga",
        "nav.mylist": "My List",
        "nav.watchparty": "Watch Party",
        "nav.search": "Search",
        "nav.settings": "Settings",
        "src.all": "All",
        "src.anime": "Anime",
        "src.series": "Series",
        "src.movies": "Movies",
        "src.manga": "Manga",
        "src.live": "Live TV",
        "src.megakino": "Megakino",
        "src.kinox": "Kinox",
        "src.burningseries": "Burningseries",
        "lang.all": "All",
        "search.placeholder": "Search titles, genres...",
        "btn.surprise": "Surprise me",
        "btn.debug": "Toggle debug logs",
        "btn.search": "Search",
        "home.empty": "No Media in the catalog yet.",
        "row.continue": "Continue Watching",
        "row.mylist": "My List",
        "row.recommended": "Recommended For You",
        "row.new": "New Additions",
        "row.because": "Because you watched {title}",
        "genre.empty": "No matches in this genre.",
        "mylist.empty": "Your list is empty. Tap the + button on any title to add it here.",
        "search.results": "Results for \"{q}\"",
        "search.empty": "No results found.",
        "play": "Play",
        "moreInfo": "More Info",
        "modal.inMyList": "In My List",
        "action.watched": "Watched",
        "action.unwatch": "Unwatch",
        "card.removeTitle": "Remove from Continue Watching",
        "wt.title": "Watch Together",
        "wt.desc": "Watch together with friends in real-time. Create a lobby or join an existing one.",
        "wt.create": "Create Lobby",
        "wt.lobbyId": "Lobby ID",
        "wt.join": "Join",
        "wt.yourName": "Your name:",
        "wt.inviteLabel": "Invite link",
        "wt.copyLink": "Copy",
        "wt.copied": "Link copied",
        "wt.copyFailed": "Could not copy link",
        "wt.leave": "Leave Lobby",
        "wt.chatPlaceholder": "Message...",
        "wt.send": "Send",
        "wt.you": "you",
        "wt.host": "Host",
        "wt.kick": "Kick",
        "wt.kicked": "You were removed from the lobby",
        "wt.nowHost": "You are now the host",
        "wt.joined": "{name} joined",
        "wt.left": "A participant left",
        "wt.waitingContent": "Waiting for the host to start something...",
        "wt.watching": "Watching: {title}",
        "wt.nameRequired": "Please enter your name",
        "wt.lobbyIdRequired": "Please enter a lobby ID",
        "loading": "Loading...",
        "toast.removedContinue": "Removed from Continue Watching",
        "toast.undo": "Undo",
        "toast.addedMyList": "Added to My List",
        "toast.removedMyList": "Removed from My List",
        "toast.catalogFailed": "Catalog could not be loaded.",
        "season": "Season",
        "episode": "Episode",
        "ep.watched": "Watched",
        "ep.resume": "Resume at {time}",
        "ep.source": "source",
        "player.sources": "Sources",
        "player.next": "Next",
        "player.nextEpisode": "Next Episode",
        "player.autoplayNext": "Auto-Play Next",
        "player.lastEpisode": "Last episode reached.",
        "player.autoplayOn": "Auto-Play enabled",
        "player.autoplayOff": "Auto-Play disabled",
        "player.markedWatched": "Marked as watched",
        "player.markedUnwatched": "Marked as unwatched",
        "player.upNext": "Up Next",
        "player.playNow": "Play Now",
        "player.cancel": "Cancel",
        "player.fsNotSupported": "Fullscreen not supported on this device",
        "player.fsError": "Fullscreen error: ",
        "player.error": "Error: {msg}<br><small>Try another hoster below.</small>",
        "player.streamUnavailable": "Stream temporarily unavailable.<br>Please try another hoster.",
        "player.noSourcesLang": "No sources available in this language.",
        "player.share": "Share",
        "player.shareCopied": "Link copied!",
        "player.trailer": "Watch Trailer",
        "player.markedWatched": "Marked as watched",
        "player.markedUnwatched": "Marked as unwatched",
        "player.hiddenGems": "Hidden Gems",
        "player.trending": "Trending",
        "player.becauseWatched": "Because you watched {title}",
        "modal.duration": "Duration",
        "modal.year": "Year",
        "modal.rating": "Rating",
        "modal.votes": "votes",
        "modal.imdb": "IMDB",
        "modal.cast": "Cast",
        "modal.directors": "Directors",
        "modal.trailer": "Watch Trailer",
        "modal.trailerUnavailable": "Trailer not available.",
        "settings.title": "Settings",
        "settings.lang": "Language",
        "settings.langEn": "English",
        "settings.langDe": "Deutsch",
        "settings.note": "Choose your preferred language. Changes apply instantly across the whole app.",
    },
    de: {
        "doc.title": "MYSTREAM",
        "nav.home": "Home",
        "nav.live": "Live TV",
        "nav.manga": "Manga",
        "nav.mylist": "My List",
        "nav.watchparty": "Watch Party",
        "nav.search": "Search",
        "nav.settings": "Settings",
        "src.all": "All",
        "src.anime": "Anime",
        "src.series": "Series",
        "src.movies": "Movies",
        "src.manga": "Manga",
        "src.live": "Live TV",
        "src.megakino": "Megakino",
        "src.kinox": "Kinox",
        "src.burningseries": "Burningseries",
        "lang.all": "All",
        "search.placeholder": "Search titles, genres...",
        "btn.surprise": "Surprise me",
        "btn.debug": "Toggle debug logs",
        "btn.search": "Search",
        "home.empty": "No Media in the catalog yet.",
        "row.continue": "Continue Watching",
        "row.mylist": "My List",
        "row.recommended": "Recommended For You",
        "row.new": "New Additions",
        "row.because": "Because you watched {title}",
        "genre.empty": "No matches in this genre.",
        "mylist.empty": "Your list is empty. Tap the + button on any title to add it here.",
        "search.results": "Results for \"{q}\"",
        "search.empty": "No results found.",
        "play": "Play",
        "moreInfo": "More Info",
        "modal.inMyList": "In My List",
        "action.watched": "Watched",
        "action.unwatch": "Unwatch",
        "card.removeTitle": "Remove from Continue Watching",
        "wt.title": "Watch Together",
        "wt.desc": "Watch together with friends in real-time. Create a lobby or join an existing one.",
        "wt.create": "Create Lobby",
        "wt.lobbyId": "Lobby ID",
        "wt.join": "Join",
        "wt.yourName": "Your name:",
        "wt.inviteLabel": "Invite link",
        "wt.copyLink": "Copy",
        "wt.copied": "Link copied",
        "wt.copyFailed": "Could not copy link",
        "wt.leave": "Leave Lobby",
        "wt.chatPlaceholder": "Message...",
        "wt.send": "Send",
        "wt.you": "you",
        "wt.host": "Host",
        "wt.kick": "Kick",
        "wt.kicked": "You were removed from the lobby",
        "wt.nowHost": "You are now the host",
        "wt.joined": "{name} joined",
        "wt.left": "A participant left",
        "wt.waitingContent": "Waiting for the host to start something...",
        "wt.watching": "Watching: {title}",
        "wt.nameRequired": "Please enter your name",
        "wt.lobbyIdRequired": "Please enter a lobby ID",
        "loading": "Loading...",
        "toast.removedContinue": "Removed from Continue Watching",
        "toast.undo": "Undo",
        "toast.addedMyList": "Added to My List",
        "toast.removedMyList": "Removed from My List",
        "toast.catalogFailed": "Catalog could not be loaded.",
        "season": "Season",
        "episode": "Episode",
        "ep.watched": "Watched",
        "ep.resume": "Resume at {time}",
        "ep.source": "source",
        "player.sources": "Sources",
        "player.next": "Next",
        "player.nextEpisode": "Next Episode",
        "player.autoplayNext": "Auto-Play Next",
        "player.lastEpisode": "Last episode reached.",
        "player.autoplayOn": "Auto-Play enabled",
        "player.autoplayOff": "Auto-Play disabled",
        "player.markedWatched": "Marked as watched",
        "player.markedUnwatched": "Marked as unwatched",
        "player.upNext": "Up Next",
        "player.playNow": "Play Now",
        "player.cancel": "Cancel",
        "player.fsNotSupported": "Fullscreen not supported on this device",
        "player.fsError": "Fullscreen error: ",
        "player.error": "Error: {msg}<br><small>Try another hoster below.</small>",
        "player.streamUnavailable": "Stream temporarily unavailable.<br>Please try another hoster.",
        "player.noSourcesLang": "No sources available in this language.",
        "player.share": "Share",
        "player.shareCopied": "Link copied!",
        "player.trailer": "Watch Trailer",
        "player.markedWatched": "Marked as watched",
        "player.markedUnwatched": "Marked as unwatched",
        "player.hiddenGems": "Hidden Gems",
        "player.trending": "Trending",
        "player.becauseWatched": "Because you watched {title}",
        "modal.duration": "Duration",
        "modal.year": "Year",
        "modal.rating": "Rating",
        "modal.votes": "votes",
        "modal.imdb": "IMDB",
        "modal.cast": "Cast",
        "modal.directors": "Directors",
        "modal.trailer": "Watch Trailer",
        "modal.trailerUnavailable": "Trailer not available.",
        "settings.title": "Settings",
        "settings.lang": "Language",
        "settings.langEn": "English",
        "settings.langDe": "German",
        "settings.note": "Choose your preferred language. Changes apply instantly across the whole app.",
    },
};

let lang = (() => { try { return localStorage.getItem("mystream_lang") || "en"; } catch { return "en"; } })();

function t(key, vars) {
    const dict = (I18N[lang] && I18N[lang][key] != null) ? I18N[lang] : I18N.en;
    let s = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
    return s;
}

const SOURCE_LABEL_KEYS = { all: "src.all", anime: "src.anime", series: "src.series", movie: "src.movies", manga: "src.manga", megakino: "src.megakino", kinox: "src.kinox", burningseries: "src.burningseries" };

function applyI18n() {
    document.title = t("doc.title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    const sLabel = document.getElementById("sourceDropdownLabel");
    if (sLabel) sLabel.textContent = t(SOURCE_LABEL_KEYS[state.currentSource] || "src.all");
    const lLabel = document.getElementById("langDropdownLabel");
    if (lLabel) lLabel.textContent = state.currentLangFilter === "all" ? t("lang.all") : state.currentLangFilter;
}

function setLang(l) {
    lang = (l === "de") ? "de" : "en";
    try { localStorage.setItem("mystream_lang", lang); } catch {}
    applyI18n();
    if (!document.querySelector(".player-overlay")) render();
    else buildGenres();
}

const translationCache = new Map();

async function localizedDescription(slug, text) {
    if (!text) return "";
    if (lang === "de") return text;
    const cacheKey = `${lang}:${slug}:${text}`;
    if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
    try {
        const res = await fetch(`/api/translate?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`);
        if (res.ok) {
          const data = await res.json();
          const translated = data.translated || text;
          translationCache.set(cacheKey, translated);
          return translated;
        }
    } catch {}
    return text;
}

function loadProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}

function saveProgress() { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); renderCacheHtml = ""; }
const pkey = (s, se, e) => `${s}:S${se}E${e}`;

function getP(s, se, e) {
    return progress[pkey(s, se, e)] || { pos: 0, dur: 0, watched: false, updated: 0 };
}

function setP(s, se, e, data) {
    progress[pkey(s, se, e)] = { ...getP(s, se, e), ...data, updated: Date.now() };
    saveProgress();
}
const mpkey = (slug, chIdx) => `manga:${slug}:C${chIdx}`;
function getMP(slug, chIdx) {
    return progress[mpkey(slug, chIdx)] || { page: 0, pages: 0, updated: 0 };
}
function setMP(slug, chIdx, data) {
    progress[mpkey(slug, chIdx)] = { ...getMP(slug, chIdx), ...data, updated: Date.now() };
    saveProgress();
}
function lastReadMangaChapter(slug, totalChapters) {
    let best = null;
    for (let i = 0; i < (totalChapters || 999); i++) {
        const p = getMP(slug, i);
        if (p.updated && (!best || p.updated > best.updated)) best = { idx: i, page: p.page, updated: p.updated };
    }
    return best;
}

function loadMyList() {
    try { return JSON.parse(localStorage.getItem(MYLIST_KEY)) || []; } catch { return []; }
}

function saveMyList() { localStorage.setItem(MYLIST_KEY, JSON.stringify(myList)); renderCacheHtml = ""; }
const inList = (slug) => myList.includes(slug);

function toggleList(slug) {
    if (inList(slug)) myList = myList.filter((s) => s !== slug);
    else myList.unshift(slug);
    saveMyList();
    return inList(slug);
}

const fmt = (sec) => {
    sec = Math.floor(sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
};
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanChapterTitle(title) {
    if (!title) return "";
    return title
        .replace(/\bs\d+\s*e\d+\b/gi, "")
        .replace(/\bS\d+\s*E\d+\b/g, "")
        .replace(/\s*[-–—:]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const inflightRequests = new Map();
async function getJson(url) {
    debugLog("fetch", url);
    if (inflightRequests.has(url)) {
        return inflightRequests.get(url);
    }
    const promise = fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    }).finally(() => {
        inflightRequests.delete(url);
    });
    inflightRequests.set(url, promise);
    try {
        return await promise;
    } catch (e) {
        debugLog("fetch FAILED", url, e);
        throw e;
    }
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t);
        t = setTimeout(() => fn(...a), ms); };
}

function showToast(msg, action) {
    toastEl.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = msg;
    toastEl.appendChild(span);
    if (action) {
        const btn = document.createElement("button");
        btn.className = "toast-action";
        btn.textContent = action.label;
        btn.addEventListener("click", () => { action.onClick(); toastEl.classList.remove("show"); });
        toastEl.appendChild(btn);
    }
    toastEl.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("show"), action ? 4000 : 1800);
}

function scrollViewTop() { window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" }); }

function isAnimeRecord(rec) {
  if (rec.source === "aniworld") return true;
  if (rec.source === "sto") return (rec.genres || []).some((g) => String(g).toLowerCase() === "anime");
  return false;
}

async function fetchCatalog(fresh = true) {
    const sourceMap = { anime: "aniworld", series: "series", movie: "movies", manga: "manga" };
    const apiSource = sourceMap[state.currentSource] || "all";
    const url = fresh ? `/api/catalog?source=${apiSource}` : `/api/catalog?source=${apiSource}`;
    allCatalog = await getJson(url);
    try {
      const mangaData = await getJson("/api/manga/catalog");
      const filteredManga = state.currentSource && state.currentSource !== "all" && state.currentSource !== "manga"
        ? mangaData.filter(item => item.type === state.currentSource)
        : mangaData;
      allCatalog = [...allCatalog, ...filteredManga];
    } catch (e) {
      debugLog("manga catalog load failed", e);
    }
    applyLangFilter();
  }

function applySourceFilter() {
    loadCatalog();
}

async function loadCatalog() {
    const hadContent = !!view.querySelector(".grid, .hero, .skeleton-card");
    if (!hadContent) {
        view.innerHTML = skeletonHtml();
    }
    try {
        await fetchCatalog(true);
    } catch (e) {
        debugLog("catalog load failed", e);
    }
    buildGenres();
    buildLangDropdown();
    render();
}

function skeletonHtml() {
    return `<div class="skeleton-hero"></div>
    <div class="skeleton-row">${Array(6).fill('<div class="skeleton-card"></div>').join("")}</div>
    <div class="skeleton-row">${Array(6).fill('<div class="skeleton-card"></div>').join("")}</div>`;
}

function genreCounts() {
    const map = new Map();
    allCatalog.forEach((a) => (a.genres || []).forEach((g) => map.set(g, (map.get(g) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildGenres() {
    const counts = genreCounts();
    const chips = ["all", ...counts.map(([g]) => g).slice(0, 20)];
    genresBar.innerHTML = chips
        .map((g) => `<span class="chip${g === state.activeGenre ? " active" : ""}" data-g="${esc(g)}">${esc(g === "all" ? t("src.all") : g)}</span>`)
        .join("");
    genresBar.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", () => {
            state.activeGenre = c.dataset.g;
            state.route = "home";
            search.value = "";
            searchbox.classList.remove("active");
            setActiveNav("home");
            buildGenres();
            render();
            scrollViewTop();
        })
    );
}

function render() {
    const q = search.value.trim();
    if (q) return renderSearch(q);
    if (state.route === "mylist") return renderMyList();
    if (state.route === "watchparty") return renderWatchParty();
    if (state.route === "settings") return renderSettings();
    if (state.route === "live") return renderLiveTV();
    if (state.currentSource === "manga") return renderMangaGrid();
    if (state.activeGenre && state.activeGenre !== "all") return renderGenreGrid(state.activeGenre);
    return renderHome();
}

function renderSettings() {
    const cur = lang;
    const opts = [
        { code: "en", label: t("settings.langEn") },
        { code: "de", label: t("settings.langDe") },
    ];
    view.innerHTML = `<h2 class="page-title">${t("settings.title")}</h2>
    <div class="settings-page">
      <div class="settings-section">
        <h3 class="settings-section-title">${t("settings.lang")}</h3>
        <p class="settings-note">${t("settings.note")}</p>
        <div class="settings-options">
          ${opts.map((o) => `<button class="settings-opt${o.code === cur ? " active" : ""}" data-lang="${o.code}">${esc(o.label)}</button>`).join("")}
        </div>
      </div>
    </div>`;
    view.querySelectorAll(".settings-opt").forEach((b) =>
        b.addEventListener("click", () => {
            setLang(b.dataset.lang);
        })
    );
}

function continueList() {
    const rows = [];
    for (const k in progress) {
        const p = progress[k];
        if (p.watched || !p.pos) continue;
        const [slug] = k.split(":S");
        const m = k.match(/S(\d+)E(\d+)/);
        if (!m) continue;
        rows.push({ slug, se: +m[1], ep: +m[2], pos: p.pos, updated: p.updated });
    }
    return rows.sort((a, b) => b.updated - a.updated);
}

function pickHero(list) {
    const withCover = list.filter((a) => a.cover);
    const pool = withCover.length ? withCover : list;
    if (!pool.length) return null;
    return pool.reduce((best, a) => ((a.description || "").length > (best.description || "").length ? a : best), pool[0]);
}

function uniqueBySlug(arr) {
    const seen = new Set();
    return arr.filter((a) => {
        if (seen.has(a.slug)) return false;
        seen.add(a.slug);
        return true;
    });
}

async function renderHome() {
    if (!allCatalog.length) { view.innerHTML = emptyState(t("home.empty")); return; }

    const cacheKey = `${allCatalog.length}:${state.currentSource}:${state.currentLangFilter}:${state.activeGenre}:${myList.length}:${Object.keys(progress).length}`;
    if (renderCacheKey === cacheKey && renderCacheHtml) {
        view.innerHTML = renderCacheHtml;
        wireRows();
        wireCards();
        wireHero();
        return;
    }

    const hero = pickHero(allCatalog);
    const cont = continueList()
        .map((c) => ({ ...c, anime: allCatalog.find((a) => a.slug === c.slug) }))
        .filter((c) => c.anime)
        .sort((a, b) => {
            const aDur = a.anime.seasons.reduce((n, s) => n + s.episodes.reduce((m, e) => m + (e.duration || 0), 0), 0);
            const bDur = b.anime.seasons.reduce((n, s) => n + s.episodes.reduce((m, e) => m + (e.duration || 0), 0), 0);
            const aRem = aDur - (a.pos || 0);
            const bRem = bDur - (b.pos || 0);
            const aScore = (Date.now() - a.updated) * -1 + aRem * 0.1;
            const bScore = (Date.now() - b.updated) * -1 + bRem * 0.1;
            return bScore - aScore;
        });
    const myListItems = myList.map((slug) => allCatalog.find((a) => a.slug === slug)).filter(Boolean);
    const counts = genreCounts().filter(([, n]) => n >= 3).slice(0, 6);
    const newItems = uniqueBySlug(allCatalog.slice(-15).reverse());

    let html = hero ? heroHtml(hero) : "";

    if (cont.length) html += rowHtml(t("row.continue"), uniqueBySlug(cont.map((c) => cardHtml(c.anime, { progress: c }))));
    if (myListItems.length) html += rowHtml(t("row.mylist"), uniqueBySlug(myListItems.map((a) => cardHtml(a))));

    const recommended = uniqueBySlug(getRecommendations(cont, myListItems, 20));
    if (recommended.length) html += rowHtml(t("row.recommended"), recommended.map((a) => cardHtml(a)));

    if (newItems.length > 1) html += rowHtml(t("row.new"), newItems.map((a) => cardHtml(a)));

    const recentSlug = cont[0]?.slug;
    if (recentSlug) {
        const base = allCatalog.find((a) => a.slug === recentSlug);
        if (base) {
            const jaccard = (a, b) => {
                const setA = new Set((a.genres || []));
                const setB = new Set((b.genres || []));
                const intersection = [...setA].filter(x => setB.has(x)).length;
                const union = new Set([...setA, ...setB]).size;
                return union === 0 ? 0 : intersection / union;
            };
            const related = uniqueBySlug(allCatalog
                .filter((a) => a.slug !== recentSlug && (a.genres || []).length > 0)
                .map((a) => ({ anime: a, sim: jaccard(base, a) }))
                .filter((x) => x.sim > 0)
                .sort((a, b) => b.sim - a.sim)
                .slice(0, 20)
                .map((x) => x.anime));
            if (related.length) html += rowHtml(t("player.becauseWatched", { title: base.title || base.slug }), related.map((a) => cardHtml(a)));
        }
    }

    const trendingThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const progressCount = new Map();
    Object.values(progress).forEach(p => {
        const m = (p.key || "").match(/^([^:]+):/);
        if (m) progressCount.set(m[1], (progressCount.get(m[1]) || 0) + 1);
    });
    const trending = uniqueBySlug(allCatalog
        .filter((a) => (a.addedAt || 0) > trendingThreshold || (progressCount.get(a.slug) || 0) > 0)
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        .slice(0, 20));
    if (trending.length > 1) html += rowHtml(t("player.trending"), trending.map((a) => cardHtml(a)));

    const hiddenGems = uniqueBySlug(allCatalog
        .filter((a) => {
            const localCount = (a.seasons || []).reduce((n, s) => n + (s.episodes || []).filter(e => e.local && Object.keys(e.local).length > 0).length, 0);
            return localCount === 0 && (a.rating || 0) >= 7;
        })
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 20));
    if (hiddenGems.length > 1) html += rowHtml(t("player.hiddenGems"), hiddenGems.map((a) => cardHtml(a)));

    counts.forEach(([genre]) => {
        const items = uniqueBySlug(allCatalog.filter((a) => (a.genres || []).includes(genre)).slice(0, 15));
        if (items.length) html += rowHtml(genre, items.map((a) => cardHtml(a)));
    });

    view.innerHTML = html;
    wireRows();
    wireCards();
    wireHero();

    const heroDesc = view.querySelector(".hero-desc");
    if (heroDesc && hero && hero.description) {
        heroDesc.textContent = await localizedDescription(hero.slug, hero.description);
    }

    renderCacheKey = cacheKey;
    renderCacheHtml = html;
  }

function getRecommendations(continueWatching, myListItems, limit = 20) {
    const scored = new Map();
    const watchedSlugs = new Set([
        ...continueWatching.map(c => c.slug),
        ...myListItems.map(a => a.slug)
    ]);

    const recItems = [...continueWatching.map(c => c.anime).filter(Boolean), ...myListItems];
    const recentGenres = new Map();
    const recentTypes = new Map();
    const recentSources = new Map();

    recItems.forEach((item) => {
        if (!item) return;
        (item.genres || []).forEach(g => {
            recentGenres.set(g, (recentGenres.get(g) || 0) + 1);
        });
        const t = item.type || (item.source === "aniworld" ? "anime" : (item.source === "sto" ? "series" : "movie"));
        recentTypes.set(t, (recentTypes.get(t) || 0) + 1);
        const s = item.source || "aniworld";
        recentSources.set(s, (recentSources.get(s) || 0) + 1);
    });

    const trendingThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const progressCount = new Map();
    Object.values(progress).forEach(p => {
        const m = (p.key || "").match(/^([^:]+):/);
        if (m) progressCount.set(m[1], (progressCount.get(m[1]) || 0) + 1);
    });

    const sessionRandom = Math.random();
    allCatalog.forEach(anime => {
        if (watchedSlugs.has(anime.slug)) return;
        let score = 0;
        const animeGenres = anime.genres || [];
        const animeType = anime.type || (anime.source === "aniworld" ? "anime" : (anime.source === "sto" ? "series" : "movie"));
        const animeSource = anime.source || "aniworld";

        animeGenres.forEach(g => {
            const rg = recentGenres.get(g) || 0;
            if (rg > 0) score += 3 + rg * 5;
        });

        if (recentSources.has(animeSource)) score += 2;

        if (recentTypes.has(animeType)) score += 4;

        if ((anime.addedAt || 0) > trendingThreshold) score += 2;
        const pg = progressCount.get(anime.slug) || 0;
        if (pg > 0) score += Math.min(pg * 3, 15);

        const localCount = (anime.seasons || []).reduce((n, s) => n + (s.episodes || []).filter(e => e.local && Object.keys(e.local).length > 0).length, 0);
        if (localCount === 0 && (anime.rating || 0) >= 7) score += 6;

        const finalScore = score + (score === 0 ? sessionRandom * 3 : Math.random() * 0.5);
        if (finalScore > 0) {
            scored.set(anime.slug, { anime, score: finalScore });
        }
    });

    const sorted = [...scored.values()]
        .sort((a, b) => {
            const diff = b.score - a.score;
            if (Math.abs(diff) > 0.5) return diff;
            return (b.anime.addedAt || 0) - (a.anime.addedAt || 0);
        });

    const mainLimit = Math.floor(limit * 0.9);
    const mainRecs = sorted.slice(0, mainLimit).map(s => s.anime);

    if (mainRecs.length < limit && recItems.length > 0) {
        const recent = recItems[0];
        const sourceTypeCandidates = allCatalog.filter(a => {
            if (watchedSlugs.has(a.slug) || mainRecs.some(r => r.slug === a.slug)) return false;
            return (a.source === recent.source || (a.genres || []).some(g => (recent.genres || []).includes(g)));
        });
        const diversity = shuffleArray(sourceTypeCandidates).slice(0, limit - mainRecs.length);
        mainRecs.push(...diversity);
    }

    if (mainRecs.length < limit) {
        const remaining = shuffleArray(allCatalog)
            .filter(a => !watchedSlugs.has(a.slug) && !mainRecs.some(r => r.slug === a.slug))
            .slice(0, limit - mainRecs.length);
        mainRecs.push(...remaining);
    }

    return mainRecs.slice(0, limit);
}

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function renderGenreGrid(genre) {
    const items = uniqueBySlug(allCatalog.filter((a) => (a.genres || []).includes(genre)));
    view.innerHTML = `<h2 class="page-title">${esc(genre)}</h2>` +
        (items.length ? `<div class="grid">${items.map((a) => cardHtml(a)).join("")}</div>` : emptyState(t("genre.empty")));
    wireCards();
}

function renderMyList() {
    const items = uniqueBySlug(myList.map((slug) => allCatalog.find((a) => a.slug === slug)).filter(Boolean));
    view.innerHTML = `<h2 class="page-title">${t("row.mylist")}</h2>` +
        (items.length ? `<div class="grid">${items.map((a) => cardHtml(a)).join("")}</div>` :
            emptyState(t("mylist.empty")));
    wireCards();
}

function renderMangaGrid() {
    const items = uniqueBySlug(allCatalog.filter((a) => a.type === "manga"));
    view.innerHTML = `<h2 class="page-title">Manga</h2>` +
        (items.length ? `<div class="grid">${items.map((a) => cardHtml(a)).join("")}</div>` : emptyState(t("search.empty")));
    wireCards();
}

async function renderMangaDetail(rec) {
    const manga = allCatalog.find((a) => a.slug === rec.slug && a.type === "manga");
    if (!manga) return;
    const genres = (manga.genres || []).map(g => `<span>${esc(g)}</span>`).join("");
    const lastRead = lastReadMangaChapter(manga.slug, (manga.seasons || []).length);
    const showContinue = !!lastRead;
    modalRoot.innerHTML = `
      <div class="modal-overlay open" id="mangaModal">
        <div class="modal-box">
          <div class="modal-backdrop">
            <div class="modal-backdrop-blur" style="background-image:url('${esc(manga.cover || '')}')"></div>
            <button class="modal-close" id="mangaModalClose">${ICON.close}</button>
          </div>
          <div class="modal-heading">
            <img class="modal-poster" src="${esc(manga.cover || '')}" alt="" onerror="this.style.display='none'">
            <div class="modal-heading-text">
              <h2>${esc(manga.title || manga.slug)}</h2>
              <div class="modal-meta">${esc(manga.source || "")} ${manga.rating ? `· ${manga.rating}` : ""}</div>
              <div class="modal-genres">${genres}</div>
            </div>
          </div>
          <div class="modal-body">
            <div id="mangaDesc"><div class="empty-state">${t("loading") || "Loading..."}</div></div>
            <div class="modal-actions">
              ${showContinue ? `<button class="btn-primary" id="mangaContinueBtn">Continue Chapter ${lastRead.idx + 1}</button>` : ""}
              <button class="btn-secondary" id="mangaReadBtn">${showContinue ? "From Beginning" : "Read"}</button>
            </div>
            <div id="mangaChapters">
              <div class="empty-state" style="display:flex;flex-direction:column;align-items:center;gap:12px">
                <div class="spinner"></div>
                <div>${t("loading") || "Loading chapters..."}</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById("mangaModalClose").addEventListener("click", closeMangaDetail);
    document.getElementById("mangaModal").addEventListener("click", (e) => {
      if (e.target.id === "mangaModal") closeMangaDetail();
    });
    const continueBtn = document.getElementById("mangaContinueBtn");
    const readBtn = document.getElementById("mangaReadBtn");
    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        openMangaReader(manga, null, lastRead.idx, lastRead.page);
      });
    }
    if (readBtn) {
      readBtn.addEventListener("click", () => openMangaReader(manga));
    }
    const descEl = document.getElementById("mangaDesc");
    if (descEl && manga.description) {
        const desc = await localizedDescription(manga.slug, manga.description);
        descEl.innerHTML = `<p class="modal-desc">${esc(desc)}</p>`;
    } else if (descEl) {
        descEl.innerHTML = "";
    }
    loadMangaChapters(manga);
}

let liveTVChannels = [];
let liveTVSchedule = [];

async function renderLiveTV() {
    view.innerHTML = `<h2 class="page-title">${t("nav.live")}</h2>
      <div class="live-tv-tabs">
        <button class="live-tv-tab active" data-live-tab="channels">Channels</button>
        <button class="live-tv-tab" data-live-tab="schedule">Schedule</button>
      </div>
      <div id="liveTVContent"></div>`;
    
    const tabs = view.querySelectorAll(".live-tv-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            const tabName = tab.dataset.liveTab;
            if (tabName === "channels") renderLiveTVChannels();
            else renderLiveTVSchedule();
        });
    });
    
    await loadLiveTVData();
    renderLiveTVChannels();
}

async function loadLiveTVData() {
    const content = document.getElementById("liveTVContent");
    if (!content) return;
    content.innerHTML = `<div class="empty-state">${t("loading") || "Loading..."}</div>`;
    try {
        const res = await getJson("/api/live-tv");
        liveTVChannels = res.channels || [];
        liveTVSchedule = res.schedule || [];
    } catch (e) {
        content.innerHTML = `<div class="empty-state">${t("player.streamUnavailable") || "Failed to load Live TV"}</div>`;
    }
}

function renderLiveTVChannels() {
    const content = document.getElementById("liveTVContent");
    if (!content) return;
    if (!liveTVChannels.length) {
        content.innerHTML = `<div class="empty-state">${t("player.streamUnavailable") || "No channels available"}</div>`;
        return;
    }
    content.innerHTML = `<div class="live-tv-grid">${liveTVChannels.map(ch => `
        <div class="live-tv-card" data-stream="${esc(ch.streamUrl || ch.stream || '')}">
            <div class="live-tv-poster">
                ${ch.logo || ch.cover ? `<img src="${esc(ch.logo || ch.cover)}" alt="" onerror="this.style.display='none'">` : `<div class="placeholder">${esc(ch.name || 'Live')}</div>`}
                <div class="live-badge">LIVE</div>
            </div>
            <div class="live-tv-info">
                <div class="live-tv-name">${esc(ch.name || 'Unknown Channel')}</div>
                ${ch.category ? `<div class="live-tv-category">${esc(ch.category)}</div>` : ""}
            </div>
        </div>
    `).join("")}</div>`;
    
    content.querySelectorAll(".live-tv-card").forEach(card => {
        card.addEventListener("click", async () => {
            const stream = card.dataset.stream;
            const title = card.querySelector(".live-tv-name")?.textContent || "Live TV";
            if (!stream) return;
            playLiveTV(stream, title);
        });
    });
}

function renderLiveTVSchedule() {
    const content = document.getElementById("liveTVContent");
    if (!content) return;
    if (!liveTVSchedule.length) {
        content.innerHTML = `<div class="empty-state">${t("player.streamUnavailable") || "No schedule available"}</div>`;
        return;
    }
    content.innerHTML = `<div class="live-tv-schedule">${liveTVSchedule.map(item => `
        <div class="schedule-item">
            <div class="schedule-time">${esc(item.time || '')}</div>
            <div class="schedule-info">
                <div class="schedule-title">${esc(item.title || 'Live Event')}</div>
                ${item.channel ? `<div class="schedule-channel">${esc(item.channel)}</div>` : ""}
            </div>
            ${item.live ? '<div class="live-badge schedule-live">LIVE</div>' : ""}
        </div>
    `).join("")}</div>`;
}

function playLiveTV(streamUrl, title) {
    const overlay = document.createElement("div");
    overlay.className = "player-overlay";
    overlay.id = "liveTVPlayer";
    overlay.innerHTML = `
      <div class="player-top">
        <button class="player-back" id="liveTVBack">${ICON.close}</button>
        <div class="player-title">
          ${esc(title || "Live TV")}
          <small>Live Stream</small>
        </div>
      </div>
      <div class="player-main" style="background:#000">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0">
          <video id="liveTVVideo" controls autoplay playsinline style="width:100%;height:100%;object-fit:contain;background:#000"></video>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const backBtn = document.getElementById("liveTVBack");
    if (backBtn) backBtn.addEventListener("click", () => overlay.remove());
    const video = document.getElementById("liveTVVideo");
    if (!video || !streamUrl) return;

    const isHls = /\.m3u8(\?|$)/i.test(streamUrl);
    if (isHls && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error("Live TV HLS error:", data);
                video.src = streamUrl;
                video.play().catch(() => {});
            }
        });
    } else {
        video.src = streamUrl;
        video.play().catch(() => {});
    }
}

async function loadMangaChapters(manga, openIdx) {
    const container = document.getElementById("mangaChapters");
    if (!container) return;
    container.innerHTML = `<div class="empty-state" style="display:flex;flex-direction:column;align-items:center;gap:12px"><div class="spinner"></div><div>${t("loading") || "Loading chapters..."}</div></div>`;
    try {
      const res = await getJson(`/api/manga/chapters?mangaId=${encodeURIComponent(manga.slug)}&source=${encodeURIComponent(manga.source || "mangadex")}`);
      const chapters = res.chapters || [];
      if (!chapters.length) {
        container.innerHTML = `<div class="empty-state">${t("player.streamUnavailable") || "No chapters found"}</div>`;
        return;
      }
      container.innerHTML = `<h3 class="page-title" style="font-size:16px;margin:0 0 10px">${t("season") || "Chapters"}</h3>` +
        chapters.map((ch, i) => {
          const rp = getMP(manga.slug, i);
          const read = rp.updated > 0;
          return `<div class="ep-row${read ? " watched" : ""}" data-chapter="${ch.id}" data-idx="${i}">
            <div class="ep-info">
              <div class="ep-name">${esc(cleanChapterTitle(ch.title) || `Chapter ${ch.number || i + 1}`)}</div>
              <div class="ep-sub">${ch.pages ? `${ch.pages} pages` : ""}${read ? " ✓" : ""}</div>
            </div>
          </div>`;
        }).join("");
      container.querySelectorAll(".ep-row").forEach((row) => {
        row.addEventListener("click", () => {
          const chId = row.dataset.chapter;
          const idx = parseInt(row.dataset.idx, 10);
          openMangaReader(manga, chapters, idx);
        });
      });
      if (typeof openIdx === "number" && chapters[openIdx]) {
        openMangaReader(manga, chapters, openIdx);
      }
    } catch (e) {
      container.innerHTML = `<div class="empty-state">${t("player.streamUnavailable") || "Failed to load chapters"}: ${esc(e.message)}</div>`;
    }
  }

function closeMangaDetail() {
    const modal = modalRoot.querySelector(".modal-overlay");
    if (modal) {
        modal.classList.remove("open");
        setTimeout(() => { modalRoot.innerHTML = ""; }, 200);
    }
}

async function openMangaReader(manga, chapters, startIdx = 0, startPage = 0) {
    closeMangaDetail();
    const overlay = document.createElement("div");
    overlay.className = "player-overlay";
    overlay.id = "mangaReader";
    overlay.innerHTML = `
      <div class="player-top">
        <button class="player-back" id="mangaReaderBack">${ICON.close}</button>
        <div class="player-title">
          ${esc(manga.title || manga.slug)}
          <small id="mangaPageLabel">Page 1 / 1</small>
        </div>
      </div>
      <div class="player-main" style="background:#000">
        <div id="mangaImgWrap" style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;position:relative;overflow:hidden;cursor:grab">
          <img id="mangaPageImg" src="" alt="" style="max-width:100%;max-height:100%;object-fit:contain;transition:transform .15s ease;transform-origin:center center;user-select:none;-webkit-user-drag:none">
          <div id="mangaSpinner" class="player-spinner"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="player-bottom" style="background:#111116;border-top:1px solid #1c1c26;padding:10px 16px">
        <div class="pb-row">
          <button class="action-btn" id="mangaPrev">Prev</button>
          <span style="color:#9a9aa5;font-size:13px" id="mangaChapterLabel">Chapter 1</span>
          <button class="action-btn" id="mangaNext">Next</button>
          <span style="flex:1"></span>
          <button class="action-btn" id="mangaZoomOut">-</button>
          <span style="color:#9a9aa5;font-size:13px;min-width:48px;text-align:center" id="mangaZoomLabel">100%</span>
          <button class="action-btn" id="mangaZoomIn">+</button>
          <button class="action-btn" id="mangaZoomReset">Reset</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const backBtn = document.getElementById("mangaReaderBack");
    if (backBtn) backBtn.addEventListener("click", () => overlay.remove());
    const prevBtn = document.getElementById("mangaPrev");
    const nextBtn = document.getElementById("mangaNext");
    const img = document.getElementById("mangaPageImg");
    const label = document.getElementById("mangaPageLabel");
    const chLabel = document.getElementById("mangaChapterLabel");
    const spinner = document.getElementById("mangaSpinner");
    const imgWrap = document.getElementById("mangaImgWrap");
    const zoomLabel = document.getElementById("mangaZoomLabel");
    const zoomInBtn = document.getElementById("mangaZoomIn");
    const zoomOutBtn = document.getElementById("mangaZoomOut");
    const zoomResetBtn = document.getElementById("mangaZoomReset");
    let currentPages = [];
    let pageIdx = 0;
    let zoomScale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let lastPanX = 0;
    let lastPanY = 0;

    function applyZoom() {
      const displayScale = Math.round(zoomScale * 100);
      zoomLabel.textContent = displayScale + "%";
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
      img.style.cursor = zoomScale > 1 ? (isDragging ? "grabbing" : "grab") : "default";
    }

    function resetZoom() {
      zoomScale = 1;
      panX = 0;
      panY = 0;
      applyZoom();
    }

    function clampPan() {
      if (zoomScale <= 1) {
        panX = 0;
        panY = 0;
        return;
      }
      const wrapRect = imgWrap.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const scaledWidth = img.naturalWidth * zoomScale;
      const scaledHeight = img.naturalHeight * zoomScale;
      if (scaledWidth > wrapRect.width) {
        const maxPanX = (scaledWidth - wrapRect.width) / 2 / zoomScale;
        panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
      } else {
        panX = 0;
      }
      if (scaledHeight > wrapRect.height) {
        const maxPanY = (scaledHeight - wrapRect.height) / 2 / zoomScale;
        panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
      } else {
        panY = 0;
      }
    }

    function zoomAt(delta, clientX, clientY) {
      const wrapRect = imgWrap.getBoundingClientRect();
      const mouseX = clientX - wrapRect.left - wrapRect.width / 2;
      const mouseY = clientY - wrapRect.top - wrapRect.height / 2;
      const oldScale = zoomScale;
      const factor = Math.exp(-delta * 0.001);
      zoomScale = Math.min(5, Math.max(1, zoomScale * factor));
      const scaleChange = zoomScale / oldScale;
      panX = mouseX - (mouseX - panX) * scaleChange;
      panY = mouseY - (mouseY - panY) * scaleChange;
      clampPan();
      applyZoom();
    }

    if (zoomInBtn) zoomInBtn.addEventListener("click", () => { zoomScale = Math.min(5, zoomScale + 0.25); clampPan(); applyZoom(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => { zoomScale = Math.max(1, zoomScale - 0.25); clampPan(); applyZoom(); });
    if (zoomResetBtn) zoomResetBtn.addEventListener("click", resetZoom);

    imgWrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || true) {
        zoomAt(e.deltaY, e.clientX, e.clientY);
      }
    }, { passive: false });

    imgWrap.addEventListener("mousedown", (e) => {
      if (zoomScale > 1) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        lastPanX = panX;
        lastPanY = panY;
        img.style.cursor = "grabbing";
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      panX = lastPanX + (e.clientX - dragStartX) / zoomScale;
      panY = lastPanY + (e.clientY - dragStartY) / zoomScale;
      clampPan();
      applyZoom();
    });
    window.addEventListener("mouseup", () => {
      isDragging = false;
      applyZoom();
    });

    let lastTouchDist = 0;
    let lastTouchMid = { x: 0, y: 0 };
    imgWrap.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
        lastTouchMid = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
      }
    }, { passive: true });
    imgWrap.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const mid = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
        if (lastTouchDist > 0) {
          const delta = (lastTouchDist - dist) * 2;
          zoomAt(delta, mid.x, mid.y);
        }
        lastTouchDist = dist;
        lastTouchMid = mid;
      }
    }, { passive: false });
    imgWrap.addEventListener("touchend", () => { lastTouchDist = 0; });

    async function loadChapter(chapterId, page = 0) {
      spinner.style.display = "flex";
      img.style.display = "none";
      resetZoom();
      try {
        const res = await getJson(`/api/manga/pages?chapterId=${encodeURIComponent(chapterId)}&source=${encodeURIComponent(manga.source || "mangadex")}`);
        currentPages = res.pages || [];
        pageIdx = Math.min(page, Math.max(0, currentPages.length - 1));
        if (currentPages.length) {
          img.src = currentPages[pageIdx];
          img.style.display = "block";
          label.textContent = `Page ${pageIdx + 1} / ${currentPages.length}`;
        } else {
          label.textContent = "No pages";
        }
      } catch (e) {
        label.textContent = "Failed to load pages";
      }
      spinner.style.display = "none";
    }
    if (!chapters) {
      const res = await getJson(`/api/manga/chapters?mangaId=${encodeURIComponent(manga.slug)}&source=${encodeURIComponent(manga.source || "mangadex")}`);
      chapters = res.chapters || [];
    }
    const chapter = chapters[startIdx];
    if (chapter) {
      chLabel.textContent = `Chapter ${chapter.number || startIdx + 1}`;
      await loadChapter(chapter.id, startPage);
      setMP(manga.slug, startIdx, { page: startPage, pages: currentPages.length });
    }
    prevBtn.addEventListener("click", async () => {
      if (!currentPages.length) return;
      pageIdx = (pageIdx - 1 + currentPages.length) % currentPages.length;
      img.src = currentPages[pageIdx];
      label.textContent = `Page ${pageIdx + 1} / ${currentPages.length}`;
      if (typeof startIdx === "number") setMP(manga.slug, startIdx, { page: pageIdx, pages: currentPages.length });
    });
    nextBtn.addEventListener("click", async () => {
      if (!currentPages.length) return;
      pageIdx = (pageIdx + 1) % currentPages.length;
      img.src = currentPages[pageIdx];
      label.textContent = `Page ${pageIdx + 1} / ${currentPages.length}`;
      if (typeof startIdx === "number") setMP(manga.slug, startIdx, { page: pageIdx, pages: currentPages.length });
    });
  }

function renderWatchParty() {
    const wt = window.watchPartyManager;
    if (wt.lobbyId) {
        renderWatchPartyLobby(wt);
        return;
    }

    const savedName = loadWtName();
    const prefillId = pendingJoinLobbyId || "";
    const isJoinFlow = !!prefillId;
    view.innerHTML = `<div class="watchparty-page${isJoinFlow ? " watchparty-join-flow" : ""}">
      <h2 class="page-title">${t("wt.title")}</h2>
      <div class="watchparty-card">
        <p>${t("wt.desc")}</p>
        <input id="wpName" class="watchparty-name" placeholder="${t("wt.yourName")}" value="${esc(savedName)}" maxlength="24" autocomplete="off" />
        <div class="watchparty-actions">
          <button class="btn-primary" id="wpCreate">${t("wt.create")}</button>
          <div class="watchparty-join">
            <input id="wpJoinId" placeholder="${t("wt.lobbyId")}" value="${esc(prefillId)}" autocomplete="off" />
            <button class="btn-secondary" id="wpJoin">${t("wt.join")}</button>
          </div>
        </div>
        ${isJoinFlow ? `<p class="watchparty-join-hint">${t("wt.lobbyIdRequired")}</p>` : ""}
      </div>
    </div>`;

    const nameInput = document.getElementById("wpName");
    const joinInput = document.getElementById("wpJoinId");
    document.getElementById("wpCreate").addEventListener("click", () => {
        const name = nameInput.value.trim();
        if (!name) return showToast(t("wt.nameRequired"));
        wt.createLobby(name);
    });
    const doJoin = () => {
        const lobbyId = joinInput.value.trim();
        const name = nameInput.value.trim();
        if (!name) return showToast(t("wt.nameRequired"));
        if (!lobbyId) return showToast(t("wt.lobbyIdRequired"));
        wt.joinLobby(lobbyId, name);
    };
    document.getElementById("wpJoin").addEventListener("click", doJoin);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });
    joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

    if (prefillId && savedName) {
        wt.joinLobby(prefillId, savedName);
    }
    pendingJoinLobbyId = null;
}

function renderWatchPartyLobby(wt) {
    const inviteUrl = `${location.origin}/join/${wt.lobbyId}`;
    view.innerHTML = `<div class="watchparty-page">
      <h2 class="page-title">${t("wt.title")}</h2>
      <div class="watchparty-card">
        <div class="watchparty-invite">
          <span class="watchparty-invite-label">${t("wt.inviteLabel")}</span>
          <div class="watchparty-invite-row">
            <input id="wpInviteLink" readonly value="${esc(inviteUrl)}" />
            <button class="btn-secondary" id="wpCopyLink">${t("wt.copyLink")}</button>
          </div>
        </div>
        <div class="watchparty-participants" id="wpParticipants"></div>
        <button class="btn-secondary watchparty-leave" id="wpLeave">${t("wt.leave")}</button>
      </div>
      <div id="wpStatus" class="watchparty-status"></div>
      <div class="watchparty-chat-box">
        <div id="wpChat" class="watchparty-chat"></div>
        <div class="watchparty-chat-input">
          <input id="wpChatInput" placeholder="${t("wt.chatPlaceholder")}" maxlength="500" autocomplete="off" />
          <button class="btn-secondary" id="wpChatSend">${t("wt.send")}</button>
        </div>
      </div>
    </div>`;

    renderParticipants();
    setWpStatus(wt.content ? t("wt.watching", { title: wt.content.title || wt.content.slug }) : t("wt.waitingContent"));

    document.getElementById("wpCopyLink").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            showToast(t("wt.copied"));
        } catch {
            showToast(t("wt.copyFailed"));
        }
    });
    document.getElementById("wpLeave").addEventListener("click", () => wt.leaveLobby());

    const chatInput = document.getElementById("wpChatInput");
    const sendChat = () => {
        wt.sendChat(chatInput.value);
        chatInput.value = "";
    };
    document.getElementById("wpChatSend").addEventListener("click", sendChat);
    chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
}

function setWpStatus(text) {
    const el = document.getElementById("wpStatus");
    if (el) el.textContent = text;
}

function appendChatMessage(user, message) {
    const chatEl = document.getElementById("wpChat");
    if (!chatEl) return;
    const div = document.createElement("div");
    div.className = "watchparty-msg";
    div.innerHTML = `<strong>${esc(user)}</strong>: ${esc(message)}`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
}

function renderParticipants() {
    const wt = window.watchPartyManager;
    const el = document.getElementById("wpParticipants");
    if (!el) return;
    el.innerHTML = wt.clients.map((c) => `
      <div class="wp-participant">
        <span class="wp-dot"></span>
        <span class="wp-name">${esc(c.userName)}${c.userId === wt.userId ? ` (${t("wt.you")})` : ""}</span>
        ${c.isHost ? `<span class="wp-badge">${t("wt.host")}</span>` : ""}
        ${wt.isHost && c.userId !== wt.userId ? `<button class="wp-kick" data-kick="${esc(c.userId)}">${t("wt.kick")}</button>` : ""}
      </div>`).join("") + `<div class="wp-count">${wt.clients.length}/${MAX_LOBBY_SIZE}</div>`;
    el.querySelectorAll("[data-kick]").forEach((btn) => {
        btn.addEventListener("click", () => wt.kick(btn.dataset.kick));
    });
}

function renderSearch(q) {
    const query = q.toLowerCase();
    const items = uniqueBySlug(allCatalog.filter((a) =>
        (a.title || "").toLowerCase().includes(query) ||
        a.slug.includes(query) ||
        (a.genres || []).some((g) => g.toLowerCase().includes(query))
    ));
    view.innerHTML = `<h2 class="page-title">${t("search.results", { q: esc(q) })}</h2>` +
        (items.length ? `<div class="grid">${items.map((a) => cardHtml(a)).join("")}</div>` : emptyState(t("search.empty")));
    wireCards();
}

function emptyState(msg) {
    return `<div class="empty-state">${esc(msg)}</div>`;
}

function rowHtml(title, cardsHtml) {
    return `<section class="row">
    <h3 class="row-title">${esc(title)}</h3>
    <div class="row-viewport">
      <button class="row-arrow left" data-dir="-1">${ICON.chevronLeft}</button>
      <div class="row-track noscrollbar">${cardsHtml.join("")}</div>
      <button class="row-arrow right" data-dir="1">${ICON.chevronRight}</button>
    </div>
  </section>`;
}

function gridHtml(cardsHtml) {
    return `<div class="grid noscrollbar">${cardsHtml.join("")}</div>`;
  }

function cardHtml(a, opts = {}) {
    const prog = opts.progress;
    const img = a.cover
        ? `<img src="${esc(a.cover)}" alt="" onerror="this.style.display='none'">`
        : "";
    const placeholder = `<div class="placeholder">${esc(a.title || a.slug)}</div>`;
    const pct = prog && prog.pos ? Math.min(100, (prog.pos / (getP(a.slug, prog.se, prog.ep).dur || prog.pos || 1)) * 100) : 0;
    const badge = prog ? `<div class="card-badge">S${prog.se}E${prog.ep}</div>` : "";
    const pbar = prog && pct ? `<div class="card-pbar"><div class="card-pfill" style="width:${pct}%"></div></div>` : "";
    const remove = prog ? `<button class="card-remove" data-act="remove" title="${t("card.removeTitle")}">${ICON.close}</button>` : "";
    const listed = inList(a.slug);
    const dataAttrs = prog ? ` data-se="${prog.se}" data-ep="${prog.ep}"` : "";
    return `<div class="card" data-slug="${esc(a.slug)}"${dataAttrs}>
    <div class="card-poster">
      ${placeholder}
      ${img}${badge}${pbar}${remove}
      <div class="card-overlay">
        <div class="ov-title">${esc(a.title || a.slug)}</div>
        <div class="card-actions">
          <button data-act="play" title="${t("play")}">${ICON.play}</button>
          <button data-act="list" class="${listed ? "active" : ""}" title="${t("row.mylist")}">${listed ? ICON.check : ICON.plus}</button>
          <button data-act="info" title="${t("moreInfo")}">${ICON.info}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function makeHorizontalScrollable(el, delayMs = 0) {
    let isDown = false, startX = 0, startScroll = 0, moved = false;
    let hoverTimer = null;
    let hoverReady = false;
    let hoverStart = 0;

    if (delayMs > 0) {
        el.addEventListener("mouseenter", () => {
            hoverStart = Date.now();
            hoverReady = false;
            hoverTimer = setTimeout(() => {
                hoverReady = true;
                el.style.cursor = "ew-resize";
            }, delayMs);
        });
        el.addEventListener("mouseleave", () => {
            clearTimeout(hoverTimer);
            hoverReady = false;
            hoverStart = 0;
            el.style.cursor = "";
        });
    }

    el.addEventListener("mousedown", (e) => {
        isDown = true;
        moved = false;
        startX = e.pageX;
        startScroll = el.scrollLeft;
        el.classList.add("dragging");
    });
    window.addEventListener("mouseup", () => { isDown = false; el.classList.remove("dragging"); });
    window.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        const dx = e.pageX - startX;
        if (Math.abs(dx) > 4) moved = true;
        el.scrollLeft = startScroll - dx;
    });
    el.addEventListener("click", (e) => {
        if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);
    el.addEventListener("wheel", (e) => {
        if (delayMs > 0 && !hoverReady) return;
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        el.scrollLeft += e.deltaX;
    }, { passive: false });
}

function wireRows() {
    view.querySelectorAll(".row-viewport").forEach((vp) => {
        const track = vp.querySelector(".row-track");
        vp.querySelectorAll(".row-arrow").forEach((btn) =>
            btn.addEventListener("click", () => {
                track.scrollBy({ left: Number(btn.dataset.dir) * track.clientWidth * 0.9, behavior: "smooth" });
            })
        );
        makeHorizontalScrollable(track, 5000);
    });
}

function wireCards() {
    view.querySelectorAll(".card").forEach((c) => {
        const slug = c.dataset.slug;
        c.addEventListener("click", (e) => {
            const act = e.target.closest("button")?.dataset.act;
            if (!act) return openDetail(slug);
            e.stopPropagation();
            if (act === "info") return openDetail(slug);
            if (act === "remove") {
                const se = Number(c.dataset.se);
                const ep = Number(c.dataset.ep);
                const prev = getP(slug, se, ep);
                setP(slug, se, ep, { pos: 0, watched: false });
                render();
                showToast(t("toast.removedContinue"), {
                    label: t("toast.undo"),
                    onClick: () => { setP(slug, se, ep, prev); render(); },
                });
                return;
            }
            if (act === "list") {
                const on = toggleList(slug);
                const btn = e.target.closest("button");
                btn.classList.toggle("active", on);
                btn.innerHTML = on ? ICON.check : ICON.plus;
                if (on) {
                    showToast(t("toast.addedMyList"));
                } else {
                    showToast(t("toast.removedMyList"), {
                        label: t("toast.undo"),
                        onClick: () => { toggleList(slug); render(); },
                    });
                }
                return;
            }
            if (act === "play") return quickPlay(slug);
        });
    });
}

function heroHtml(a) {
    const genres = (a.genres || []).slice(0, 3).join(" \u2022 ");
    return `<section class="hero" data-slug="${esc(a.slug)}">
    <div class="hero-bg" style="background-image:url('${esc(a.cover || "")}')"></div>
    <div class="hero-content">
      <h1>${esc(a.title || a.slug)}</h1>
      ${genres ? `<p class="hero-tags">${esc(genres)}</p>` : ""}
      ${a.description ? `<p class="hero-desc">${esc(a.description)}</p>` : ""}
      <div class="hero-actions">
        <button class="btn-primary" data-hero-act="play">${ICON.play}<span>${t("play")}</span></button>
        <button class="btn-secondary" data-hero-act="info">${ICON.info}<span>${t("moreInfo")}</span></button>
      </div>
    </div>
  </section>`;
}

function wireHero() {
    const hero = view.querySelector(".hero");
    if (!hero) return;
    const slug = hero.dataset.slug;
    hero.querySelector('[data-hero-act="info"]')?.addEventListener("click", () => openDetail(slug));
    hero.querySelector('[data-hero-act="play"]')?.addEventListener("click", () => quickPlay(slug));
}

async function quickPlay(slug) {
    showToast(t("loading"));
    const source = getSourceForSlug(slug);
    const rec = await getJson("/api/title/" + source + "/" + slug);
    if (rec.type === "manga") {
        state.record = rec;
        await renderMangaDetail(rec);
        return;
    }
    state.record = rec;
    const last = lastWatched(rec);
    state.season = last ? last.season : rec.seasons[0]?.season ?? null;
    state.episode = last ? last.episode : rec.seasons[0]?.episodes[0]?.episode ?? null;
    openPlayer();
}

function lastWatched(rec) {
    let best = null;
    for (const s of rec.seasons)
        for (const e of s.episodes) {
            const p = getP(rec.slug, s.season, e.episode);
            if (p.updated && (!best || p.updated > best.updated)) best = { season: s.season, episode: e.episode, updated: p.updated };
        }
    return best;
}

function getSourceForSlug(slug) {
    const rec = allCatalog.find((a) => a.slug === slug);
    return rec ? rec.source : "aniworld";
}

const LANG_MAPPINGS = {
    aniworld: { 1: "GerDub", 2: "EngSub", 3: "GerSub" },
    sto: { 1: "GerDub", 2: "EngSub", 3: "GerSub" },
    filmpalast: { 1: "Ger", 2: "Eng" },
};

const LANG_OPTIONS = {
    aniworld: [
        { value: "0", label: "All" },
        { value: "1", label: "GerDub" },
        { value: "2", label: "EngSub" },
        { value: "3", label: "GerSub" },
    ],
    sto: [
        { value: "0", label: "All" },
        { value: "1", label: "GerDub" },
        { value: "2", label: "EngSub" },
        { value: "3", label: "GerSub" },
    ],
    filmpalast: [
        { value: "0", label: "All" },
        { value: "1", label: "Ger" },
        { value: "2", label: "Eng" },
    ],
};

function getLangMapping(source) {
    return LANG_MAPPINGS[source] || LANG_MAPPINGS.aniworld;
}

function hasLanguage(rec, langFilter) {
    if (langFilter === "all") return true;
    const source = rec.source || "aniworld";
    const mapping = getLangMapping(source);
    const wantedKey = Object.entries(mapping).find(([, v]) => v === langFilter)?.[0];
    if (!wantedKey) return false;
    for (const s of rec.seasons || []) {
        for (const e of s.episodes || []) {
            if ((e.hosters || []).some((h) => String(h.langKey) === wantedKey)) return true;
            if (e.local && e.local[langFilter]) return true;
        }
    }
    return false;
}

function buildLangDropdown() {
    const menu = document.getElementById("langDropdownMenu");
    if (!menu) return;
    const langSet = new Set();
    allCatalog.forEach((a) => {
        for (const s of a.seasons || []) {
            for (const e of s.episodes || []) {
                for (const h of e.hosters || []) {
                    const tag = tagFor(h.langKey, a.source || "aniworld");
                    if (tag) langSet.add(tag);
                }
            }
        }
    });
    menu.innerHTML = `<button class="lang-dropdown-item${state.currentLangFilter === "all" ? " active" : ""}" data-lang="all" data-i18n="lang.all">${t("lang.all")}</button>` +
        [...langSet].map((l) => `<button class="lang-dropdown-item${state.currentLangFilter === l ? " active" : ""}" data-lang="${esc(l)}">${esc(l)}</button>`).join("");

    menu.querySelectorAll(".lang-dropdown-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const lang = btn.dataset.lang;
            state.currentLangFilter = lang;
            langDropdownLabel.textContent = btn.textContent;
            menu.querySelectorAll(".lang-dropdown-item").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            menu.classList.remove("open");
            applyLangFilter();
            render();
        });
    });
}

async function applyLangFilter() {
    if (state.currentLangFilter !== "all") {
        allCatalog = allCatalog.filter((a) => {
            const source = a.source || "aniworld";
            const mapping = getLangMapping(source);
            const wantedKey = Object.entries(mapping).find(([, v]) => v === state.currentLangFilter)?.[0];
            if (!wantedKey) return false;
            for (const s of a.seasons || []) {
                for (const e of s.episodes || []) {
                    if ((e.hosters || []).some((h) => String(h.langKey) === wantedKey)) return true;
                    if (e.local && e.local[state.currentLangFilter]) return true;
                }
            }
            return false;
        });
    }
}

function tagFor(v, source) {
    const mapping = getLangMapping(source);
    return mapping[v] || null;
}

async function openDetail(slug) {
    const rec = allCatalog.find((a) => a.slug === slug);
    if (rec && rec.type === "manga") {
        await renderMangaDetail(rec);
        return;
    }
    if (!state.record || state.record.slug !== slug) {
        modalRoot.innerHTML = modalSkeleton();
        openModalEl();
        const source = getSourceForSlug(slug);
        state.record = await getJson("/api/title/" + source + "/" + slug);
        const last = lastWatched(state.record);
        state.season = last ? last.season : state.record.seasons[0]?.season ?? null;
        state.episode = last ? last.episode : state.record.seasons[0]?.episodes[0]?.episode ?? null;
    }
    await buildDetailModal();
    openModalEl();
}

function modalSkeleton() {
    return `<div class="modal-overlay open"><div class="modal-box"><div class="skeleton-hero" style="height:220px"></div></div></div>`;
}

function openModalEl() {
    const ov = modalRoot.querySelector(".modal-overlay");
    if (ov) requestAnimationFrame(() => ov.classList.add("open"));
}

function closeDetail() {
    const ov = modalRoot.querySelector(".modal-overlay");
    if (!ov) return;
    ov.classList.remove("open");
    setTimeout(() => { modalRoot.innerHTML = ""; }, 200);
}

async function buildDetailModal() {
    const rec = state.record;
    const listed = inList(rec.slug);
    const isMovie = rec.type === "movie" || (rec.seasons.length === 1 && rec.seasons[0].episodes.length === 1 && rec.seasons[0].season === 1);
    const totalEp = rec.seasons.reduce((n, s) => n + s.episodes.length, 0);
    const season = rec.seasons.find((s) => s.season === state.season);
    const ep = season ? season.episodes[0] : null;
    const p = ep ? getP(rec.slug, state.season, state.episode) : { pos: 0, dur: 0, watched: false, updated: 0 };

    modalRoot.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-box">
        <div class="modal-backdrop">
          <div class="modal-backdrop-blur" style="background-image:url('${esc(rec.cover || "")}')"></div>
          <button class="modal-close" id="modalClose">${ICON.close}</button>
        </div>
        <div class="modal-heading">
          ${rec.cover ? `<img class="modal-poster" src="${esc(rec.cover)}" alt="" onerror="this.style.display='none'">` : ""}
          <div class="modal-heading-text">
            <h2>${esc(rec.title || rec.slug)}</h2>
            ${isMovie ? `
              <p class="modal-meta">
                ${rec.duration ? `${t("modal.duration")}: ${rec.duration} min` : ""}
                ${rec.year ? ` \u00b7 ${t("modal.year")}: ${rec.year}` : ""}
                ${rec.rating ? ` \u00b7 ${t("modal.rating")}: ${rec.rating}${rec.votes ? ` (${rec.votes} ${t("modal.votes")})` : ""}` : ""}
                ${rec.imdb ? ` \u00b7 ${t("modal.imdb")}: ${rec.imdb}/10` : ""}
                ${rec.category ? ` \u00b7 ${esc(rec.category)}` : ""}
              </p>
              ${rec.cast?.length ? `<div class="modal-cast">${t("modal.cast")}: ${esc(rec.cast.join(", "))}</div>` : ""}
              ${rec.directors?.length ? `<div class="modal-cast">${t("modal.directors")}: ${esc(rec.directors.join(", "))}</div>` : ""}
            ` : `<p class="modal-meta">${rec.seasons.length} Season${rec.seasons.length !== 1 ? "s" : ""} \u00b7 ${totalEp} Episodes${rec.category ? " \u00b7 " + esc(rec.category) : ""}</p>`}
          </div>
        </div>
        <div class="modal-body">
          ${rec.genres?.length ? `<div class="modal-genres">${rec.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>` : ""}
          ${rec.description ? `<p class="modal-desc">${esc(rec.description)}</p>` : ""}
          <div class="modal-actions">
            <button class="btn-primary" id="modalPlay">${ICON.play}<span>${t("play")}</span></button>
            <button class="btn-ghost" id="modalList">${listed ? ICON.check : ICON.plus}<span>${listed ? t("modal.inMyList") : t("row.mylist")}</span></button>
            ${isMovie && rec.trailer ? `<button class="btn-ghost" id="modalTrailer">${ICON.info}<span>${t("modal.trailer")}</span></button>` : ""}
          </div>
          ${isMovie ? `<div class="hoster-row" id="epList"></div>` : ""}
          <div class="season-tabs${isMovie ? " hidden" : ""}" id="seasonTabs"></div>
          <div class="ep-list${isMovie ? " hidden" : ""}" id="epList"></div>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector("#modalClose").addEventListener("click", closeDetail);
    modalRoot.querySelector(".modal-overlay").addEventListener("click", (e) => { if (e.target.classList.contains("modal-overlay")) closeDetail(); });
    modalRoot.querySelector("#modalPlay").addEventListener("click", openPlayer);
    modalRoot.querySelector("#modalList").addEventListener("click", (e) => {
        const on = toggleList(rec.slug);
        const btn = e.currentTarget;
        btn.innerHTML = `${on ? ICON.check : ICON.plus}<span>${on ? t("modal.inMyList") : t("row.mylist")}</span>`;
        if (on) {
            showToast(t("toast.addedMyList"));
        } else {
            showToast(t("toast.removedMyList"), {
                label: t("toast.undo"),
                onClick: () => {
                    toggleList(rec.slug);
                    btn.innerHTML = `${ICON.check}<span>${t("modal.inMyList")}</span>`;
                },
            });
        }
    });

    if (isMovie && rec.trailer) {
        const trailerBtn = modalRoot.querySelector("#modalTrailer");
        if (trailerBtn) {
            trailerBtn.addEventListener("click", () => {
                window.open(rec.trailer, "_blank", "noopener,noreferrer");
            });
        }
    }

    const seasonTabs = modalRoot.querySelector("#seasonTabs");
    if (!isMovie) {
        rec.seasons.forEach((s) => {
            const b = document.createElement("button");
            b.textContent = t("season") + " " + s.season;
            if (s.season === state.season) b.classList.add("active");
            b.addEventListener("click", () => {
                state.season = s.season;
                state.episode = s.episodes[0]?.episode ?? null;
                seasonTabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
                b.classList.add("active");
                renderEpList();
            });
            seasonTabs.appendChild(b);
        });
        renderEpList();
    } else {
        renderMovieHosters();
    }

    const modalDesc = modalRoot.querySelector(".modal-desc");
    if (modalDesc && rec.description) {
        modalDesc.textContent = await localizedDescription(rec.slug, rec.description);
    }
}

function renderMovieHosters() {
    const rec = state.record;
    const list = modalRoot.querySelector("#epList");
    if (!list) return;
    const season = rec.seasons[0];
    const ep = season ? season.episodes[0] : null;
    if (!ep) return;

    const p = getP(rec.slug, state.season, state.episode);
    const pct = p.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0;
    const cur = state.episode === ep.episode ? " current" : "";

    list.innerHTML = `
      <div class="ep-row${cur}" data-ep="${ep.episode}">
        <div class="ep-info">
          <div class="ep-name">${esc(rec.title || rec.slug)}</div>
          <div class="ep-sub">${p.watched ? t("ep.watched") : (p.pos ? t("ep.resume", { time: fmt(p.pos) }) : t("play"))} \u00b7 ${ep.hosters.length} ${t("ep.source")}${ep.hosters.length !== 1 ? "s" : ""}</div>
        </div>
        <div class="ep-pfill-wrap"><div class="ep-pfill" style="width:${pct}%"></div></div>
        ${p.watched ? `<div class="ep-check">${ICON.check}</div>` : `<div class="ep-play-hint">${ICON.play}</div>`}
      </div>
      <div class="movie-hosters" style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;">
        ${ep.hosters.map((h, i) => `<button class="hoster-btn" data-idx="${i}">${esc(h.hoster)}</button>`).join("")}
      </div>
    `;

    list.querySelectorAll(".ep-row").forEach((row) => {
        row.addEventListener("click", (e) => {
            if (e.target.closest(".hoster-btn")) return;
            state.episode = Number(row.dataset.ep);
            openPlayer();
        });
    });

    list.querySelectorAll(".hoster-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.episode = ep.episode;
            openPlayer();
        });
    });
}

function renderEpList() {
    const rec = state.record;
    const isMovie = rec.type === "movie" || (rec.seasons.length === 1 && rec.seasons[0].episodes.length === 1 && rec.seasons[0].season === 1);
    if (isMovie) return;
    const season = rec.seasons.find((s) => s.season === state.season);
    const list = modalRoot.querySelector("#epList");
    if (!list || !season) return;
    list.innerHTML = season.episodes
        .map((e) => {
            const p = getP(rec.slug, season.season, e.episode);
            const pct = p.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0;
            const cur = season.season === state.season && e.episode === state.episode ? " current" : "";
            const thumbSrc = e.thumb || rec.cover || "";
            const thumbHtml = thumbSrc
                ? `<img class="ep-thumb-img" src="${esc(thumbSrc)}" alt="" onerror="this.style.display='none'">`
                : "";
            const epName = esc(cleanChapterTitle(e.name || (t("episode") + " " + e.episode)));
            const epSub = p.watched ? t("ep.watched") : (p.pos ? t("ep.resume", { time: fmt(p.pos) }) : (t("episode") + " " + e.episode));
            return `<div class="ep-row${cur}" data-ep="${e.episode}">
            <div class="ep-thumb">${thumbHtml}<span class="ep-thumb-num">${e.episode}</span><div class="ep-pfill-wrap"><div class="ep-pfill" style="width:${pct}%"></div></div></div>
            <div class="ep-info">
              <div class="ep-name">${epName}</div>
              <div class="ep-sub">${esc(epSub)} \u00b7 ${e.hosters.length} ${t("ep.source")}${e.hosters.length !== 1 ? "s" : ""}</div>
            </div>
            ${p.watched ? `<div class="ep-check">${ICON.check}</div>` : `<div class="ep-play-hint">${ICON.play}</div>`}
          </div>`;
        })
        .join("");
    list.querySelectorAll(".ep-row").forEach((row) =>
        row.addEventListener("click", () => {
            state.episode = Number(row.dataset.ep);
            openPlayer();
        })
    );
}

function openPlayer() {
    closeDetail();
    const rec = state.record;
    const isMovie = rec.type === "movie" || (rec.seasons.length === 1 && rec.seasons[0].episodes.length === 1 && rec.seasons[0].season === 1);
    const season = rec.seasons.find((s) => s.season === state.season);
    const ep = season.episodes.find((e) => e.episode === state.episode);
    const p = getP(rec.slug, state.season, state.episode);
    setP(rec.slug, state.season, state.episode, { pos: p.pos, dur: p.dur, watched: p.watched });

    const wpm = window.watchPartyManager;
    if (wpm && wpm.isHost && wpm.lobbyId) {
        wpm.sendContent(rec.source || "aniworld", rec.slug, state.season, state.episode, rec.title || rec.slug);
    }

    playerRoot.innerHTML = `
    <div class="player-overlay">
      <div class="player-top">
        <button class="player-back" id="playerBack">${ICON.back}</button>
        <div class="player-title">${esc(rec.title || rec.slug)}<small>${isMovie ? "" : `${t("season")} ${state.season} · ${t("episode")} ${state.episode}`}</small></div>
      </div>
      <div class="player-main">
        <div style="position:relative;flex:1;display:flex;flex-direction:column;min-height:0;">
          <div class="player-box" id="playerBox">
            <div class="player-spinner" id="playerSpinner"><div class="spinner"></div>${t("loading")}</div>
          </div>
          <div class="player-controls-overlay" id="playerControlsOverlay">
            <div class="ctrl-bottom">
              <div class="ctrl-progress">
                <span class="time-display" id="ctrlCurrent">0:00</span>
                <input type="range" id="ctrlSeek" min="0" max="100" value="0" step="0.1" />
                 <span class="time-display" id="ctrlDuration">0:00</span>
              </div>
              <div class="ctrl-buttons">
                <button id="ctrlPlayPause">${ICON.play}</button>
                <button id="ctrlVolume" title="Mute">${'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>'}</button>
                <button id="ctrlFullscreen">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'}</button>
                <button class="airplay-btn" id="ctrlAirPlay" title="AirPlay / Cast" style="display:none">${'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>'}</button>
                <button class="speed-btn" id="ctrlSpeed">1x</button>
                <span class="spacer"></span>
                ${!isMovie ? `<button id="ctrlNext" title="${t("player.nextEpisode")}">${ICON.chevronRight}</button>` : ""}
                ${!isMovie ? `<button id="ctrlAutoPlay" title="${t("player.autoplayNext")}">${ICON.repeat}</button>` : ""}
              </div>
            </div>
          </div>
        </div>
        <div class="player-bottom" id="playerBottom">
          <div class="pb-row" id="hosterRow">
            <span class="pb-label">${t("player.sources")}</span>
          </div>
          <div class="pb-row">
            <button class="action-btn" id="btnMark">${p.watched ? ICON.plus : ICON.check}<span>${p.watched ? t("action.unwatch") : t("action.watched")}</span></button>
            ${!isMovie ? `<button class="action-btn primary" id="btnNextEp">${ICON.chevronRight}<span>${t("player.next")}</span></button>` : ""}
            <button class="action-btn" id="btnWatchTogether">${ICON.shuffle}<span>${t("wt.title")}</span></button>
            <button class="action-btn" id="btnShare">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'}<span>${t("player.share")}</span></button>
            <select class="player-langsel" id="playerLang" aria-label="Switch language"></select>
          </div>
        </div>
      </div>
    </div>`;

    let vid = null;
    let controlsVisible = true;
    let hideTimeout = null;
    const CONTROLS_HIDE_DELAY = 3000;
    const autoPlayKey = "mystream_autoplay_v1";
    let autoPlayEnabled = localStorage.getItem(autoPlayKey) !== "0";
    let nextUpTimer = null;
    let nextUpShownForVideo = null;
    const NEXT_UP_WINDOW_START = 600;
    const NEXT_UP_WINDOW_END = 480;
    const NEXT_UP_COUNTDOWN = 15;
    const MIN_PLAYBACK_BEFORE_PROMPT = 60;

    const box = document.getElementById("playerBox");
    const spinner = document.getElementById("playerSpinner");
    const overlay = document.getElementById("playerControlsOverlay");
    const seek = document.getElementById("ctrlSeek");
    const currentDisplay = document.getElementById("ctrlCurrent");
    const durationDisplay = document.getElementById("ctrlDuration");
    const playPauseBtn = document.getElementById("ctrlPlayPause");
    const volumeBtn = document.getElementById("ctrlVolume");
    const fullscreenBtn = document.getElementById("ctrlFullscreen");
    const airPlayBtn = document.getElementById("ctrlAirPlay");
    const speedBtn = document.getElementById("ctrlSpeed");
    const nextBtn = document.getElementById("ctrlNext");
    const nextEpBtn = document.getElementById("btnNextEp");
    const markBtn = document.getElementById("btnMark");
    const watchTogetherBtn = document.getElementById("btnWatchTogether");
    const autoPlayBtn = document.getElementById("ctrlAutoPlay");
    const hosterRow = document.getElementById("hosterRow");

    if (autoPlayBtn) {
        autoPlayBtn.classList.toggle("active", autoPlayEnabled);
    }

    function scheduleHide() {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => {
            if (vid && !vid.paused) {
                controlsVisible = false;
                overlay.classList.remove("visible");
            }
        }, CONTROLS_HIDE_DELAY);
    }
    function showControls() {
        controlsVisible = true;
        overlay.classList.add("visible");
        scheduleHide();
    }
    function hideControlsNow() {
        if (vid && vid.paused) return;
        controlsVisible = false;
        overlay.classList.remove("visible");
        clearTimeout(hideTimeout);
    }
    showControls();
    activePlayerShowControls = showControls;
    box.addEventListener("mousemove", showControls);
    box.addEventListener("pointermove", showControls);
    overlay.addEventListener("mousemove", showControls);
    overlay.addEventListener("pointermove", showControls);

    // AirPlay / Cast
    if (airPlayBtn) {
        const showAirPlay = () => {
            if (vid && vid.src) {
                try {
                    if (typeof vid.setSinkId !== "undefined") {
                        vid.setSinkId("").catch(() => {});
                    }
                } catch {}
                const evt = new Event("airplayrequest", { bubbles: true });
                vid.dispatchEvent(evt);
            }
        };
        airPlayBtn.style.display = "flex";
        airPlayBtn.addEventListener("click", showAirPlay);
    }

    document.getElementById("playerBack").addEventListener("click", () => { closePlayer();
        openDetail(rec.slug); });

    const langFilter = state.currentLangFilter;
    const source = rec.source || "aniworld";
    const mapping = getLangMapping(source);
    const wantedKey = langFilter === "all" ? null : Object.entries(mapping).find(([, v]) => v === langFilter)?.[0];
    const hosters = ep.hosters
        .filter((h) => !wantedKey || String(h.langKey) === wantedKey)
        .sort((a, b) => (b.hoster === "Vidmoly") - (a.hoster === "Vidmoly"));

    let autoHoster = null;
    hosterRow.innerHTML = "";

    function makeHosterSection(title, buttons, openByDefault) {
        const section = document.createElement("div");
        section.className = "hoster-section" + (openByDefault ? " open" : "");
        const toggle = document.createElement("button");
        toggle.className = "hoster-toggle";
        toggle.innerHTML = `<span class="hoster-title">${esc(title)}<span class="hoster-count">${buttons.length}</span></span>${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>'}`;
        toggle.addEventListener("click", () => {
            section.classList.toggle("open");
        });
        const list = document.createElement("div");
        list.className = "hoster-list";
        buttons.forEach((btn) => {
            list.appendChild(btn);
            if (!autoHoster) autoHoster = btn;
        });
        section.appendChild(toggle);
        section.appendChild(list);
        hosterRow.appendChild(section);
        if (openByDefault && buttons.length === 1) section.classList.add("open");
    }

    if (ep.local) {
        const localBtns = [];
        const langFilter = state.currentLangFilter;
        const mapping = getLangMapping(rec.source || "aniworld");
        Object.keys(ep.local).forEach((tag) => {
            const btn = document.createElement("button");
            btn.className = "hoster-btn";
            btn.textContent = tag;
            btn.dataset.url = ep.local[tag];
            btn.dataset.local = "1";
            btn.addEventListener("click", () => {
                setActiveHoster(btn);
                playLocal(ep.local[tag]);
            });
            const want = tagFor(langFilter, rec.source || "aniworld");
            const isAuto = (langFilter !== "all" && tag === want) || (!autoHoster && langFilter === "all");
            localBtns.push({ btn, auto: isAuto });
        });
        makeHosterSection("Local Files", localBtns.map((x) => x.btn), true);
        const localAuto = localBtns.find((x) => x.auto);
        if (localAuto) autoHoster = localAuto.btn;
    }

    if (hosters.length) {
        const hosterBtns = hosters.map((h) => {
            const btn = document.createElement("button");
            btn.className = "hoster-btn";
            btn.textContent = h.hoster;
            btn.dataset.hoster = JSON.stringify(h);
            btn.addEventListener("click", () => {
                setActiveHoster(btn);
                playHoster(h, btn);
            });
            return btn;
        });
        makeHosterSection("Streaming Hosts", hosterBtns, true);
        if (!autoHoster && hosterBtns.length) autoHoster = hosterBtns[0];
    }

    if (!ep.local && !hosters.length) {
        hosterRow.innerHTML = `<span style="color:#9a9aa5;font-size:13px;">${t("player.noSourcesLang")}</span>`;
    }

    const tagName = getLangMapping(source);

    buildPlayerLangSelector();
    const playerLang = document.getElementById("playerLang");
    if (playerLang) {
        playerLang.addEventListener("change", () => {
            switchPlayerLanguage(playerLang.value);
        });
    }

    function setActiveHoster(btn) {
        hosterRow.querySelectorAll(".hoster-btn").forEach((b) => b.classList.remove("active"));
        if (btn) btn.classList.add("active");
    }

    function updateSeekBg() {
        if (!seek || !vid || !vid.duration) return;
        const pct = (vid.currentTime / vid.duration) * 100;
        seek.style.background = `linear-gradient(to right, #e50914 0%, #e50914 ${pct}%, #ffffff44 ${pct}%, #ffffff44 100%)`;
    }

    function buildPlayerLangSelector() {
        const source = rec.source || "aniworld";
        const mapping = getLangMapping(source);
        const langs = new Map();
        if (ep.local) Object.keys(ep.local).forEach((t) => { langs.set(t, mapping); });
        (ep.hosters || []).forEach((h) => {
            const tag = mapping[h.langKey] || null;
            if (tag) langs.set(tag, mapping);
        });
        const sel = document.getElementById("playerLang");
        if (!sel || !langs.size) return;
        sel.innerHTML = [...langs.keys()].map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
        const currentTag = mapping[state.currentLangFilter] || null;
        sel.value = currentTag && langs.has(currentTag) ? currentTag : [...langs.keys()][0];
    }

    function tagForLang(tag, source) {
        const mapping = getLangMapping(source || "aniworld");
        const reverse = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));
        return reverse[tag] || null;
    }

    function switchPlayerLanguage(newLangTag) {
        const source = rec.source || "aniworld";
        const si = rec.seasons.findIndex((s) => s.season === state.season);
        const season = rec.seasons[si];
        const epIndex = season.episodes.findIndex((e) => e.episode === state.episode);
        const ep = season.episodes[epIndex];
        if (!ep) return;

        const langKey = tagForLang(newLangTag, source);
        if (!langKey) return;

        const localUrl = ep.local?.[newLangTag];
        const hoster = (ep.hosters || []).find((h) => String(h.langKey) === langKey);

        if (localUrl) {
            playLocal(localUrl);
        } else if (hoster) {
            const btn = document.createElement("button");
            btn.className = "hoster-btn";
            btn.textContent = hoster.hoster;
            btn.dataset.hoster = JSON.stringify(hoster);
            setActiveHoster(btn);
            playHoster(hoster, btn);
        }
    }

    let currentHls = null;
    let activeVideoId = 0;
    let lastEndedVideoId = 0;

    function setupVideo(src, isHls, embedFallback) {
        activeVideoId++;
        const myVideoId = activeVideoId;

        nextUpShownForVideo = null;
        if (nextUpTimer) {
            clearTimeout(nextUpTimer);
            nextUpTimer = null;
        }
        const staleNextUp = box.querySelector(".next-up");
        if (staleNextUp) staleNextUp.remove();

        if (currentHls) { currentHls.destroy();
            currentHls = null; }
        box.innerHTML = `<video id="vid" playsinline webkit-playsinline></video>`;
        vid = document.getElementById("vid");
        vid._videoId = myVideoId;
        activeVid = vid;
        vid.muted = false;
        vid.volume = 1;

        function tryPlay() {
            if (!vid || vid._videoId !== myVideoId) return;
            vid.play().then(() => {
                spinner.style.display = "none";
            }).catch(() => {
                spinner.style.display = "none";
            });
        }

        let lastSeenDuration = 0;
        let stableTicks = 0;

        vid.addEventListener("loadedmetadata", () => {
            seek.max = vid.duration || 0;
            durationDisplay.textContent = fmt(vid.duration);
            updateSeekBg();
            if (p.pos && !p.watched && p.pos < vid.duration - 5) {
                vid.currentTime = p.pos;
            }
            tryPlay();
        });
        vid.addEventListener("canplay", () => {
            tryPlay();
        }, { once: true });
        vid.addEventListener("durationchange", () => {
            if (vid.duration && vid.duration !== Infinity) {
                seek.max = vid.duration;
                durationDisplay.textContent = fmt(vid.duration);
            }
        });
        vid.addEventListener("timeupdate", () => {
            if (!vid.duration || vid.duration === Infinity) return;
            seek.value = vid.currentTime;
            currentDisplay.textContent = fmt(vid.currentTime);
            updateSeekBg();
            if (Math.floor(vid.currentTime) % 3 === 0) {
                setP(rec.slug, state.season, state.episode, { pos: vid.currentTime, dur: vid.duration });
            }

            if (vid.duration === lastSeenDuration) {
                stableTicks++;
            } else {
                lastSeenDuration = vid.duration;
                stableTicks = 0;
            }
            const durationIsTrustworthy = stableTicks >= 2 && vid.duration > 120;
            const remaining = vid.duration - vid.currentTime;
            const pastMinPlayback = vid.currentTime > MIN_PLAYBACK_BEFORE_PROMPT;

            if (durationIsTrustworthy && pastMinPlayback &&
                remaining <= NEXT_UP_WINDOW_START && remaining > NEXT_UP_WINDOW_END &&
                vid._videoId === activeVideoId && nextUpShownForVideo !== myVideoId) {
                nextUpShownForVideo = myVideoId;
                showNextUpPrompt(myVideoId);
            }
        });
        vid.addEventListener("ended", (e) => {
            if (e.target !== vid) return;
            if (vid._videoId !== activeVideoId) return;
            if (vid.duration && vid.currentTime < vid.duration - 3) return;
            lastEndedVideoId = vid._videoId;
            setP(rec.slug, state.season, state.episode, { watched: true, pos: 0 });
            updateSeekBg();
            if (box.querySelector(".next-up")) return;
            if (autoPlayEnabled) {
                setTimeout(() => {
                    if (vid._videoId === activeVideoId) nextEpisodeFn();
                }, 400);
            }
        });
        vid.addEventListener("play", () => { playPauseBtn.innerHTML = ICON.pause; scheduleHide(); });
        vid.addEventListener("pause", () => { playPauseBtn.innerHTML = ICON.play; showControls(); clearTimeout(hideTimeout); });

        if (isHls && Hls.isSupported()) {
            const isTV = /tv|smart|samsung|lg|sony|panasonic|philips|tizen|webos|viera/i.test(navigator.userAgent);
            const isMobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                startLevel: isTV ? -1 : (isMobile ? -1 : 0),
                capLevelToPlayerSize: !isTV,
                maxBufferLength: isTV ? 60 : 30,
                maxMaxBufferLength: isTV ? 120 : 60,
                manifestLoadingMaxRetry: 6,
                levelLoadingMaxRetry: 6,
                fragLoadingMaxRetry: 6,
                fragLoadingMaxRetryTimeout: 40000,
                manifestLoadingMaxRetryTimeout: 40000,
                levelLoadingMaxRetryTimeout: 40000,
                preferNativeHls: false,
                enableSoftwareAES: true,
                enableCEA708Captions: false,
                enableWebVTT: true,
                renderTextTracksNatively: false,
            });
            hls.config.xhrSetup = (xhr, url) => {
                try {
                    if (/voe/i.test(url)) {
                        xhr.setRequestHeader("Referer", "https://voe.to/");
                        xhr.setRequestHeader("Origin", "https://voe.to");
                    }
                } catch {}
            };
            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                if (!data.levels || !data.levels.length) return;
                const preferred = data.levels.filter(l => l.attrs && l.attrs.AUDIO && /aac|mp4a/i.test(l.attrs.AUDIO));
                if (preferred.length > 0) {
                    hls.currentLevel = preferred[0].level;
                } else {
                    hls.currentLevel = 0;
                }
            });
            hls.loadSource(src);
            hls.attachMedia(vid);
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error("HLS fatal error:", data);
                    if (embedFallback) {
                        setTimeout(() => {
                            if (vid && vid._videoId === myVideoId) playEmbed(embedFallback);
                        }, 500);
                    } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === "manifestLoadError") {
                        box.innerHTML = `<div class="empty-state">${t("player.streamUnavailable")}</div>`;
                        spinner.style.display = "none";
                    }
                }
            });
            currentHls = hls;
        } else {
            vid.src = src;
            vid.addEventListener("canplay", tryPlay, { once: true });
        }
        spinner.style.display = "none";
        showControls();
    }

    function playLocal(url) {
        setupVideo(url, false);
    }

    async function playHoster(h, btn) {
        const original = btn.textContent;
        btn.textContent = t("loading");
        spinner.style.display = "flex";
        try {
            let epPath = h.episodePath
              ? "&epPath=" + encodeURIComponent(h.episodePath)
              : "";
            if (!epPath && rec.source === "sto" && rec.slug) {
              const ep = "/serie/" + rec.slug + "/staffel-" + state.season + "/episode-" + state.episode;
              epPath = "&epPath=" + encodeURIComponent(ep);
            }
            const data = await getJson("/api/extract?path=" + encodeURIComponent(h.redirectPath) + "&source=" + encodeURIComponent(rec.source) + epPath);
            debugLog("playHoster extract", h.hoster, h.redirectPath, data);
            const src = data.sources?.find((s) => s.endsWith(".m3u8")) || data.sources?.[0];
            if (src && src !== "VOE_BLOCKED") {
                const isHls = /\.m3u8(\?|$)/i.test(src);
                debugLog("playHoster setupVideo", src, "isHls=", isHls);
                setupVideo(src, isHls, data.embed);
            } else if (data.embed) {
                playEmbed(data.embed);
            } else {
                throw new Error("No playable source found");
            }
        } catch (e) {
            let msg = esc(e.message || String(e));
            box.innerHTML = `<div class="empty-state">${t("player.error", { msg })}</div>`;
            spinner.style.display = "none";
        }
        btn.textContent = original;
        setActiveHoster(btn);
    }

    function playEmbed(embedUrl) {
        debugLog("playEmbed", embedUrl);
        let url = embedUrl;
        const sep = url.includes("?") ? "&" : "?";
        url += sep + "autoplay=1&muted=1&_t=" + Date.now();
        box.innerHTML = `<iframe allow="autoplay; fullscreen; encrypted-media" allowfullscreen src="${url}" style="width:100%;height:100%;border:none;"></iframe>`;
        spinner.style.display = "none";
        showControls();
        setP(rec.slug, state.season, state.episode, { pos: Date.now() / 1000 });
        debugLog("playEmbed iframe src", url);
    }

    if (autoHoster) {
        setActiveHoster(autoHoster);
        if (autoHoster.dataset.local) {
            playLocal(autoHoster.dataset.url);
        } else if (autoHoster.dataset.hoster) {
            const h = JSON.parse(autoHoster.dataset.hoster);
            playHoster(h, autoHoster);
        }
    } else if (ep.local) {
        const keys = Object.keys(ep.local);
        if (keys.length) playLocal(ep.local[keys[0]]);
    }

    box.addEventListener("click", (e) => {
        if (!vid && box.querySelector("iframe")) {
            const iframe = box.querySelector("iframe");
            if (iframe && iframe.src) {
                const src = iframe.src;
                const sep = src.includes("?") ? "&" : "?";
                const newSrc = src + sep + "_t=" + Date.now();
                iframe.src = newSrc;
            }
            return;
        }
        if (!vid) return;
        if (vid.paused) {
            vid.play().catch(() => {});
            showControls();
        } else if (controlsVisible) {
            hideControlsNow();
        } else {
            showControls();
        }
    });

    seek.addEventListener("input", () => {
        if (!vid) return;
        vid.currentTime = parseFloat(seek.value);
        currentDisplay.textContent = fmt(parseFloat(seek.value));
        updateSeekBg();
        wtSend({ type: "seek", currentTime: vid.currentTime });
    });

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", async () => {
            try {
                const el = document.querySelector(".player-overlay");
                if (!el) return;
                if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                    if (vid && vid.webkitEnterFullscreen) {
                        try { await vid.webkitEnterFullscreen(); return; } catch {}
                    }
                    if (el.requestFullscreen) await el.requestFullscreen();
                    else { showToast(t("player.fsNotSupported")); return; }
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock("landscape").catch(() => {});
                    }
                } else {
                    if (document.exitFullscreen) document.exitFullscreen();
                    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                    if (screen.orientation && screen.orientation.unlock) {
                        try { screen.orientation.unlock(); } catch {}
                    }
                }
            } catch (e) {
                showToast(t("player.fsError") + e.message);
            }
        });
    }

    let volumePopup = null;
    function ensureVolumePopup() {
        if (volumePopup) return volumePopup;
        volumePopup = document.createElement("div");
        volumePopup.className = "volume-popup";
        volumePopup.innerHTML = '<input type="range" id="ctrlVolumeSlider" min="0" max="100" value="100" step="1"><span class="vol-label">100</span>';
        volumePopup.addEventListener("click", (e) => e.stopPropagation());
        const playerRoot = overlay.parentElement;
        if (playerRoot) playerRoot.appendChild(volumePopup);
        const slider = volumePopup.querySelector("#ctrlVolumeSlider");
        if (slider) {
            slider.addEventListener("input", () => {
                if (!vid) return;
                vid.muted = slider.value === "0";
                vid.volume = slider.value / 100;
                volumePopup.querySelector(".vol-label").textContent = slider.value + "%";
            });
            slider.addEventListener("change", () => {
                volumePopup.classList.remove("open");
            });
        }
        return volumePopup;
    }
    if (volumeBtn) {
        volumeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!vid) return;
            const popup = ensureVolumePopup();
            const slider = popup.querySelector("#ctrlVolumeSlider");
            slider.value = vid.muted ? 0 : Math.round(vid.volume * 100);
            popup.querySelector(".vol-label").textContent = slider.value + "%";
            popup.classList.add("open");
        });
    }
    document.addEventListener("click", (e) => {
        if (volumePopup && volumePopup.classList.contains("open") && !volumePopup.contains(e.target) && e.target !== volumeBtn) {
            volumePopup.classList.remove("open");
        }
    });

    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let speedIdx = 2;
    speedBtn.addEventListener("click", () => {
        if (!vid) return;
        speedIdx = (speedIdx + 1) % speeds.length;
        vid.playbackRate = speeds[speedIdx];
        speedBtn.textContent = speeds[speedIdx] + "x";
    });

    function nextEpisodeFn() {
        const si = rec.seasons.findIndex((s) => s.season === state.season);
        const season = rec.seasons[si];
        const ei = season.episodes.findIndex((e) => e.episode === state.episode);
        if (ei + 1 < season.episodes.length) {
            state.episode = season.episodes[ei + 1].episode;
        } else if (si + 1 < rec.seasons.length) {
            state.season = rec.seasons[si + 1].season;
            state.episode = rec.seasons[si + 1].episodes[0].episode;
        } else {
            showToast(t("player.lastEpisode"));
            return;
        }
        closePlayer();
        openPlayer();
    }

    activeNextEpisode = nextEpisodeFn;

    function toggleAutoPlay() {
        autoPlayEnabled = !autoPlayEnabled;
        localStorage.setItem(autoPlayKey, autoPlayEnabled ? "1" : "0");
        if (autoPlayBtn) autoPlayBtn.classList.toggle("active", autoPlayEnabled);
        showToast(autoPlayEnabled ? t("player.autoplayOn") : t("player.autoplayOff"));
    }
    if (autoPlayBtn) {
        autoPlayBtn.addEventListener("click", toggleAutoPlay);
    }

    markBtn.addEventListener("click", () => {
        const was = getP(rec.slug, state.season, state.episode).watched;
        setP(rec.slug, state.season, state.episode, { watched: !was, pos: was ? 0 : getP(rec.slug, state.season, state.episode).pos });
        showToast(was ? t("player.markedUnwatched") : t("player.markedWatched"));
        markBtn.innerHTML = `${!was ? ICON.plus : ICON.check}<span>${!was ? t("action.unwatch") : t("action.watched")}</span>`;
    });

    if (watchTogetherBtn) {
        watchTogetherBtn.addEventListener("click", () => openWatchTogether());
    }

    const shareBtn = document.getElementById("btnShare");
    if (shareBtn) {
        shareBtn.addEventListener("click", () => {
            const origin = location.origin;
            const url = `${origin}/#/watch/${rec.source || "aniworld"}/${rec.slug}/${state.season}/${state.episode}?t=${Math.floor((activeVid ? activeVid.currentTime : p.pos) || 0)}`;
            navigator.clipboard.writeText(url).then(() => {
                showToast(t("player.shareCopied"));
            }).catch(() => {
                showToast(t("player.shareCopied"));
            });
        });
    }

    playPauseBtn.addEventListener("click", () => {
        if (!vid) return;
        if (vid.paused) {
            vid.play();
            wtSend({ type: "play", currentTime: vid.currentTime });
        } else {
            vid.pause();
            wtSend({ type: "pause", currentTime: vid.currentTime });
        }
    });

    if (nextBtn) {
        nextBtn.addEventListener("click", () => nextEpisodeFn());
    }
    if (nextEpBtn) {
        nextEpBtn.addEventListener("click", () => nextEpisodeFn());
    }

    function showNextUpPrompt(myVideoId) {
        const si = rec.seasons.findIndex((s) => s.season === state.season);
        const season = rec.seasons[si];
        const ei = season.episodes.findIndex((e) => e.episode === state.episode);
        const hasNext = ei + 1 < season.episodes.length || si + 1 < rec.seasons.length;
        if (!hasNext) return;
        const nextLabel = ei + 1 < season.episodes.length ?
            `${t("season")} ${state.season} \u00b7 ${t("episode")} ${season.episodes[ei + 1].episode}` :
            `${t("season")} ${rec.seasons[si + 1].season} \u00b7 ${t("episode")} ${rec.seasons[si + 1].episodes[0].episode}`;
        const existing = box.querySelector(".next-up");
        if (existing) existing.remove();
        const nu = document.createElement("div");
        nu.className = "next-up";
        nu.innerHTML = `
      <div class="nu-title">${t("player.upNext")}</div>
      <div class="nu-ep">${esc(nextLabel)}</div>
      <div class="nu-actions">
        <button class="nu-play">${t("player.playNow")}</button>
        <button class="nu-cancel">${t("player.cancel")}</button>
      </div>
      <div class="nu-countdown"><div class="nu-countdown-fill"></div></div>`;
        box.appendChild(nu);
        const countdownFill = nu.querySelector(".nu-countdown-fill");
        countdownFill.style.width = "0%";
        if (autoPlayEnabled) {
            countdownFill.style.transition = `width ${NEXT_UP_COUNTDOWN}s linear`;
            requestAnimationFrame(() => { countdownFill.style.width = "100%"; });
            nextUpTimer = setTimeout(() => {
                nextUpTimer = null;
                if (nu.parentNode) nu.remove();
                if (myVideoId === activeVideoId) nextEpisodeFn();
            }, NEXT_UP_COUNTDOWN * 1000);
        }
        nu.querySelector(".nu-play").addEventListener("click", () => {
            if (nextUpTimer) { clearTimeout(nextUpTimer); nextUpTimer = null; }
            if (nu.parentNode) nu.remove();
            nextEpisodeFn();
        });
        nu.querySelector(".nu-cancel").addEventListener("click", () => {
            if (nextUpTimer) { clearTimeout(nextUpTimer); nextUpTimer = null; }
            if (nu.parentNode) nu.remove();
        });
    }
}

function closePlayer() {
    if (playerRoot.querySelector(".player-overlay")) {
        playerRoot.innerHTML = "";
    }
    activeVid = null;
    activeNextEpisode = null;
    activePlayerShowControls = null;
    if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch {}
    }
}

function setActiveNav(route) {
    document.querySelectorAll("[data-nav]").forEach((el) => el.classList.toggle("active", el.dataset.nav === route));
}

document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
        const nav = el.dataset.nav;
        if (nav === "search") {
            searchbox.classList.add("active");
            search.focus();
            return;
        }
        state.route = nav;
        state.activeGenre = "all";
        search.value = "";
        searchbox.classList.remove("active");
        setActiveNav(nav);
        buildGenres();
        render();
        scrollViewTop();
    });
});

searchToggle.addEventListener("click", () => {
    searchbox.classList.toggle("active");
    if (searchbox.classList.contains("active")) {
        search.focus();
    } else {
        search.value = "";
        render();
    }
});

document.addEventListener("click", (e) => {
    if (!searchbox.contains(e.target) && searchbox.classList.contains("active")) {
        searchbox.classList.remove("active");
        search.value = "";
        render();
    }
});
search.addEventListener("input", debounce(render, 300));

if (debugBtn) {
    debugBtn.addEventListener("click", async () => {
        appDebug = !appDebug;
        debugBtn.classList.toggle("active", appDebug);
        await setDebug(appDebug);
        showToast(appDebug ? "Debug ON" : "Debug OFF");
    });
}

const sourceDropdown = document.getElementById("sourceDropdown");
const sourceDropdownToggle = document.getElementById("sourceDropdownToggle");
const sourceDropdownLabel = document.getElementById("sourceDropdownLabel");
const sourceDropdownMenu = document.getElementById("sourceDropdownMenu");

if (sourceDropdownToggle && sourceDropdownMenu) {
    sourceDropdownToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        sourceDropdownMenu.classList.toggle("open");
    });

    sourceDropdownMenu.querySelectorAll(".source-dropdown-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const source = btn.dataset.source;
            state.currentSource = source;
            sourceDropdownLabel.textContent = btn.textContent;
            sourceDropdownMenu.querySelectorAll(".source-dropdown-item").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            sourceDropdownMenu.classList.remove("open");
            applySourceFilter();
        });
    });

    document.addEventListener("click", (e) => {
        if (!sourceDropdown.contains(e.target)) {
            sourceDropdownMenu.classList.remove("open");
        }
    });
}

const langDropdown = document.getElementById("langDropdown");
const langDropdownToggle = document.getElementById("langDropdownToggle");
const langDropdownLabel = document.getElementById("langDropdownLabel");
const langDropdownMenu = document.getElementById("langDropdownMenu");

if (langDropdownToggle && langDropdownMenu) {
    langDropdownToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        langDropdownMenu.classList.toggle("open");
    });

    langDropdownMenu.querySelectorAll(".lang-dropdown-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            const lang = btn.dataset.lang;
            state.currentLangFilter = lang;
            langDropdownLabel.textContent = btn.textContent;
            langDropdownMenu.querySelectorAll(".lang-dropdown-item").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            langDropdownMenu.classList.remove("open");
            loadCatalog();
        });
    });

    document.addEventListener("click", (e) => {
        if (!langDropdown.contains(e.target)) {
            langDropdownMenu.classList.remove("open");
        }
    });
}

shuffleBtn.addEventListener("click", () => {
    if (!allCatalog.length) return;
    const unfinished = allCatalog.filter((a) => !isFullyWatched(a.slug));
    let pool = unfinished.length ? unfinished : allCatalog;
    const recommendations = getRecommendations(
        continueList().map(c => ({ ...c, anime: allCatalog.find(a => a.slug === c.slug) })).filter(c => c.anime),
        myList.map((slug) => allCatalog.find((a) => a.slug === slug)).filter(Boolean),
        10
    );
    if (recommendations.length) {
        pool = recommendations;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    openDetail(pick.slug);
});
function isFullyWatched(slug) {
    const keys = Object.keys(progress).filter((k) => k.startsWith(slug + ":S"));
    if (!keys.length) return false;
    return keys.every((k) => progress[k].watched);
}

window.addEventListener("scroll", () => {
    topbar.classList.toggle("scrolled", window.scrollY > 10);
});

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const playerOpen = document.querySelector(".player-overlay");
    const modalOpen = modalRoot.querySelector(".modal-overlay.open");

    if (e.key === "Escape") {
        if (playerOpen) {
            const slug = state.record?.slug;
            closePlayer();
            if (slug) openDetail(slug);
        } else if (modalOpen) {
            closeDetail();
        }
        return;
    }
    if (!playerOpen) return;
    if (activePlayerShowControls) activePlayerShowControls();
    if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (activeVid) { activeVid.paused ? activeVid.play() : activeVid.pause(); }
    } else if (e.key === "ArrowLeft") {
        if (activeVid) activeVid.currentTime = Math.max(0, activeVid.currentTime - 10);
    } else if (e.key === "ArrowRight") {
        if (activeVid) activeVid.currentTime = Math.min(activeVid.duration || Infinity, activeVid.currentTime + 10);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (activeVid) { activeVid.muted = false; activeVid.volume = Math.min(1, activeVid.volume + 0.1); }
    } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (activeVid) { activeVid.volume = Math.max(0, activeVid.volume - 0.1); if (activeVid.volume === 0) activeVid.muted = true; }
    } else if (e.key.toLowerCase() === "m") {
        if (activeVid) activeVid.muted = !activeVid.muted;
    } else if (e.key.toLowerCase() === "n") {
        if (activeNextEpisode) activeNextEpisode();
    }
});

const _renderHome = renderHome;
renderHome = function() { _renderHome();
    wireHero(); };

let lastStatus = { count: -1, mtime: -1 };
let statusPollToken = 0;
let lastReloadAttempt = 0;
async function pollStatus() {
    const token = ++statusPollToken;
    try {
        const s = await getJson("/api/status");
        if (token !== statusPollToken) return;
        if (s.count !== lastStatus.count || s.mtime !== lastStatus.mtime) {
            lastStatus = { count: s.count, mtime: s.mtime };
            const now = Date.now();
            if (now - lastReloadAttempt > 5000) {
                lastReloadAttempt = now;
                if (!state.record && !document.querySelector(".player-overlay")) {
                    await fetchCatalog(false);
                    buildGenres();
                    render();
                }
            }
        }
    } catch {}
}
setInterval(pollStatus, 30000);
pollStatus();

makeHorizontalScrollable(genresBar);

loadCatalog();

class WatchPartyManager {
    constructor() {
        this.ws = null;
        this.lobbyId = null;
        this.userId = null;
        this.userName = null;
        this.isHost = false;
        this.clients = [];
        this.content = null;
        this.syncInterval = null;
        this._pending = [];
    }

    connect() {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        this.ws = new WebSocket(`${proto}//${location.host}/ws`);
        this.ws.onopen = () => {
            if (this._pending.length) {
                this._pending.forEach((msg) => this.ws.send(msg));
                this._pending = [];
            }
            const session = loadWtSession();
            if (session && session.lobbyId && session.userId && session.userName) {
                this._send(JSON.stringify({ type: "reconnect_lobby", lobbyId: session.lobbyId, userId: session.userId, userName: session.userName }));
            }
        };
        this.ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
        this.ws.onclose = () => {
            if (this.syncInterval) clearInterval(this.syncInterval);
            this.syncInterval = null;
            const session = loadWtSession();
            if (session && session.lobbyId) {
                setTimeout(() => this.connect(), 2000);
            }
        };
    }

    _send(msg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connect();
            this._pending.push(msg);
            return;
        }
        this.ws.send(msg);
    }

    createLobby(userName) {
        this.userName = userName;
        saveWtName(userName);
        this._send(JSON.stringify({ type: "create_lobby", userName }));
    }

    joinLobby(lobbyId, userName) {
        this.userName = userName;
        saveWtName(userName);
        this._send(JSON.stringify({ type: "join_lobby", lobbyId, userName }));
    }

    leaveLobby() {
        if (this.ws) this.ws.close();
        this.ws = null;
        this.lobbyId = null;
        this.userId = null;
        this.isHost = false;
        this.clients = [];
        this.content = null;
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = null;
        clearWtSession();
        renderWatchParty();
    }

    kick(targetId) {
        if (!this.isHost) return;
        this._send(JSON.stringify({ type: "kick", targetId }));
    }

    sendChat(message) {
        const trimmed = message.trim();
        if (!trimmed) return;
        this._send(JSON.stringify({ type: "chat", message: trimmed }));
    }

    sendContent(source, slug, season, episode, title) {
        if (!this.isHost || !this.lobbyId) return;
        this._send(JSON.stringify({ type: "set_content", source, slug, season, episode, title }));
    }

    startHostSyncLoop() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            if (this.isHost && activeVid && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: "sync", currentTime: activeVid.currentTime, playing: !activeVid.paused }));
            }
        }, 1000);
    }

    async applySyncState(currentTime, playing) {
        if (this.isHost) return;
        const vid = await waitForActiveVid();
        if (!vid) return;
        const apply = () => {
            if (typeof currentTime === "number" && Math.abs(vid.currentTime - currentTime) > 1.5) {
                vid.currentTime = currentTime;
            }
            if (playing && vid.paused) vid.play().catch(() => {});
            if (!playing && !vid.paused) vid.pause();
        };
        if (vid.readyState >= 1) apply();
        else vid.addEventListener("loadedmetadata", apply, { once: true });
    }

    async applySeekOnly(currentTime) {
        if (this.isHost) return;
        const vid = await waitForActiveVid();
        if (!vid) return;
        const apply = () => { vid.currentTime = currentTime; };
        if (vid.readyState >= 1) apply();
        else vid.addEventListener("loadedmetadata", apply, { once: true });
    }

    async applyRemoteContent(content) {
        if (!content || !content.slug) return;
        try {
            const rec = await getJson(`/api/title/${content.source}/${content.slug}`);
            state.record = rec;
            state.season = content.season;
            state.episode = content.episode;
            closePlayer();
            openPlayer();
        } catch (e) {
            debugLog("watchparty content load failed", e);
        }
    }

    async handleMessage(msg) {
        switch (msg.type) {
            case "lobby_created":
            case "lobby_joined":
            case "lobby_reconnected":
                this.lobbyId = msg.lobbyId;
                this.userId = msg.userId;
                this.isHost = msg.isHost;
                this.clients = msg.clients;
                this.content = msg.content;
                saveWtSession({ lobbyId: msg.lobbyId, userId: msg.userId, userName: msg.userName || this.userName });
                if (pendingJoinLobbyId) {
                    pendingJoinLobbyId = null;
                    history.replaceState(null, "", "/");
                }
                renderWatchParty();
                this.startHostSyncLoop();
                if (!this.isHost && this.content) {
                    await this.applyRemoteContent(this.content);
                    await this.applySyncState(msg.currentTime, msg.playing);
                }
                break;
            case "user_joined":
                this.clients = msg.clients;
                renderParticipants();
                setWpStatus(t("wt.joined", { name: msg.userName }));
                break;
            case "user_left":
                this.clients = msg.clients;
                renderParticipants();
                setWpStatus(t("wt.left"));
                break;
            case "you_are_host":
                this.isHost = true;
                showToast(t("wt.nowHost"));
                renderWatchParty();
                this.startHostSyncLoop();
                break;
            case "kicked":
                showToast(t("wt.kicked"));
                this.leaveLobby();
                break;
            case "content_changed":
                this.content = { source: msg.source, slug: msg.slug, season: msg.season, episode: msg.episode, title: msg.title };
                setWpStatus(t("wt.watching", { title: this.content.title || this.content.slug }));
                if (!this.isHost) await this.applyRemoteContent(this.content);
                break;
            case "sync":
                await this.applySyncState(msg.currentTime, msg.playing);
                break;
            case "play":
                await this.applySyncState(msg.currentTime, true);
                break;
            case "pause":
                await this.applySyncState(msg.currentTime, false);
                break;
            case "seek":
                await this.applySeekOnly(msg.currentTime);
                break;
            case "chat":
                appendChatMessage(msg.userName, msg.message);
                break;
            case "error":
                showToast(msg.message);
                break;
        }
    }
}

function openWatchTogether() {
    if (document.querySelector(".player-overlay")) {
        closePlayer();
    }
    state.route = "watchparty";
    renderWatchParty();
}

window.watchPartyManager = new WatchPartyManager();

window.addEventListener("unhandledrejection", (e) => {
    debugLog("unhandledrejection", e.reason);
    e.preventDefault();
});

window.addEventListener("DOMContentLoaded", async () => {
    try {
        await loadCatalog();
    } catch (e) {
        debugLog("init load failed", e);
        showToast(t("toast.catalogFailed"));
    }
    buildGenres();
    const joinMatch = location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (joinMatch) {
        pendingJoinLobbyId = joinMatch[1];
        state.route = "watchparty";
        history.replaceState(null, "", "/");
    }
    render();
    applyI18n();
    if (debugBtn) {
        try {
            const res = await getJson("/api/debug");
            debugBtn.style.display = res.debug ? "flex" : "none";
        } catch {
            debugBtn.style.display = "none";
        }
    }
    const session = loadWtSession();
    if (session && session.lobbyId && session.userId && session.userName) {
        window.watchPartyManager.connect();
    }

    checkShareLink();
    window.addEventListener("hashchange", checkShareLink);
});

function checkShareLink() {
    const hash = location.hash.replace(/^#\/?/, "");
    if (!hash.startsWith("watch/")) return;
    const [pathPart, queryPart] = hash.split("?");
    const parts = pathPart.split("/");
    if (parts.length < 3) return;
    const source = parts[1];
    const slug = parts[2];
    const season = parts[3] ? Number(parts[3]) : 1;
    const episode = parts[4] ? Number(parts[4]) : 1;
    const urlParams = new URLSearchParams(queryPart || "");
    const timestamp = urlParams.get("t") ? Number(urlParams.get("t")) : 0;

    const catalogRec = allCatalog.find((a) => a.slug === slug);
    if (!catalogRec) return;

    (async () => {
        try {
            const rec = await getJson("/api/title/" + source + "/" + slug);
            state.record = rec;
            if (rec.type === "manga") {
                await renderMangaDetail(rec);
                return;
            }
            state.season = season;
            state.episode = episode;
            openPlayer();
            const waitForVid = setInterval(() => {
                const vid = document.getElementById("vid");
                if (vid && vid.readyState >= 1) {
                    clearInterval(waitForVid);
                    if (timestamp > 0 && vid.duration && timestamp < vid.duration) {
                        vid.currentTime = timestamp;
                    }
                }
            }, 200);
            setTimeout(() => clearInterval(waitForVid), 10000);
        } catch (e) {
            debugLog("share link load failed", e);
        }
    })();
}
