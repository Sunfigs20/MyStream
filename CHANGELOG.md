# Changelog

All notable changes to this project are documented here.

## [v1.1.0] - 2026-07-24

### Added

- Manga support with dedicated catalog, detail view and page-by-page reader
- MangaDex integrated as native scraper source (official API, at-home server)
- MangaKakalot scaffolded for HTML-based catalog parsing
- Chapter title filter removes S1E0/S01E01 patterns from episode names
- Three new API endpoints: `/api/manga/catalog`, `/api/manga/chapters`, `/api/manga/pages`
- Manga reader overlay with prev/next navigation and page counter
- Manga entries merged into main catalog (type=manga)
- Source dropdown now includes MangaDex filter
- i18n labels for manga tab (EN/DE)
- `uniqueBySlug()` deduplication for all row renderings
- Fix for duplicate covers appearing in horizontal rows
- Global error handlers: `unhandledRejection`, `uncaughtException`, `warning`, `SIGINT`
- Scraper crash protection wrapping all browser/page/task logic in try-catch
- `--debug` flag for verbose scraper output
- Failed entries logged to `out/unified_errors.jsonl`
- `--retry` mode to re-scrape failed entries (max 3 retries)
- `--errors` mode to show error summary
- `--cleanup` mode to close resource-heavy processes before scraping
- Background RAM monitoring during scraping with auto-kill of heavy processes
- Pre-scrape RAM check with prompt to kill heavy processes
- Real-time RAM usage display and post-cleanup verification
- Checkpoint system for crash recovery (`unified_checkpoint.json`)
- Benchmark mode (`--benchmark` flag with timing summary)
- `/api/translate` endpoint for local DE/EN word translation
- `/api/share` endpoint for generating shareable URLs with timestamps
- Source-aware language filter in the UI
- YouTube-style shareable links with timestamps
- Manga progress tracking (last read chapter and page)
- Manga zoom support (mouse wheel, touch pinch, +/- buttons, drag)
- Source mapping: megakino and kinox categorized under filmpalast, burningseries under sto
- Source dropdown filter now based on type (anime/series/movie/manga)
- `localizedDescription()` translation via built-in dictionaries

### Changed

- Scraper uses async worker pool for parallel source processing (15-30x speedup)
- S.to episode extraction optimized (removed back-navigation)
- Card hover zoom reduced to prevent cropping in horizontal rows
- Horizontal wheel scroll activates after 5s hover on home rows
- Genres bar now horizontally scrollable
- Dynamic language detection in language dropdown based on available catalog languages
- New recommendation algorithm (genres, source, type, watch history, trending)
- YouTube-style shareable links with timestamps
- Movie layout fixed (no season/episode tabs for movies)
- Episode thumbnails fallback to series cover
- `groupChaptersIntoArcs()` groups manga chapters into arcs based on number gaps
- `isValidImageUrl()` validation hardened against malformed cover URLs
- `langSet` scoped outside season loop to prevent ReferenceError
- S.to hoster extraction improved with precise DOM selectors
- Scraper logs unified: one line per title in normal mode, detailed logs only with `--debug`
- Server skips entries with missing source field
- `mergeAnimeRecords()` retains source field from old record if new record lacks one
- Poll status interval changed from 20s to 30s, removed `/api/reload` polling
- `loadCatalog()` shows skeleton only on real reload
- Source and language filters work without reloading the catalog
- Server error handling prevents double header sending
- Connection keep-alive and 60s timeout for stable connections
- Request deduplication for identical API calls
- Render cache for identical home views
- Gzip/deflate compression for text responses
- Cache headers for static assets (1 year for fonts/images, 5 min for JS/CSS)
- Rate limiting: 120 requests per minute per IP
- File watcher for catalog changes (no manual reload needed)

### Fixed

- `isValidImageUrl` undefined function crash fixed for S.to series scraping
- `langSet` ReferenceError when series has zero seasons
- S.to episode thumbnail fallback improved (skip provider logos, use series cover)
- S.to metadata extraction extended: yearEnd, FSK, IMDB link, rating count, status
- aniworld metadata extraction extended: yearEnd, FSK, imdbId, rating value/count, status
- aniworld hoster extraction improved (parses `data-play-url` and `data-provider-name`)
- filmpalast year extraction hardened against HTML-entity variants
- Duplicate covers in horizontal rows fixed
- 516 entries without source field repaired
- 189 sto entries with malformed cover URLs set to null for frontend fallback
- Manga quickPlay and share-link open reader instead of video player
- Manga detail modal writes to `modalRoot` instead of `view` (page no longer blank after closing)
- Manga chapters and pages cached for 30 minutes on server
- Standard volume set to 100% when opening player
- Volume popup shows percentage while dragging
- Feed algorithm random factor added to prevent deterministic repetition
- S.to anime filter now shows entries with "Anime" genre
- ESM main guard repaired for Windows paths
- Scraper crash on Playwright JSON.parse fixed
- `mergeAnimeRecords()` retains source field from old record
- Scraper always runs to completion even if individual tasks crash

### Removed

- External MyMemory translation API dependency
- Description sanitization regex; original texts preserved
- Hardcoded language options removed from dropdown
- DNS pre-check (caused issues on some systems)

[v1.1.0]: https://github.com/Sunfigs20/MyStream/releases/tag/v1.1.0
[v1.0.0]: https://github.com/Sunfigs20/MyStream
