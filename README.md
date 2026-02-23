# RSS News Hub

A phased implementation of a personal RSS news aggregator that runs on GitHub Actions and serves a static dashboard through GitHub Pages.

## Current Build Status

- Completed phases: 0, 1, 2, 3, 4, 5, 6, 7
- In progress: none
- Next phase: maintenance and iterative improvements

## Security Rules

1. Never hardcode API keys in source code.
2. Keep secrets in GitHub Actions repository secrets.
3. Use `KIMI_CODE_API` from environment variables only.
4. Commit `.env.example`, never `.env`.

## Local Setup

1. Install Node.js 18+.
2. Install dependencies:

```bash
npm install
```

3. Optional: copy `.env.example` to `.env` for local tuning.
4. Run tests:

```bash
npm test
```

5. Run Phase 1-5 pipeline:

```bash
npm run run:pipeline
```

By default this runs Phase 1-5. Geotag behavior:
1. `GEOTAG_MODE=auto`: uses Kimi when `KIMI_CODE_API` exists, otherwise mock geotagging.
2. `GEOTAG_MODE=mock`: always mock geotagging.
3. `GEOTAG_MODE=live`: forces Kimi API geotagging (requires key).
4. Default model: `kimi-k2-0905-preview` with fallbacks to `kimi-k2-turbo-preview,kimi-for-coding`.
5. Live batch defaults are tuned for higher throughput:
   1. `GEOTAG_BATCH_SIZE=60`
   2. `GEOTAG_MAX_API_BATCHES=0` (`0` means unlimited batches per run)
6. Article volume defaults are no longer capped at 40:
   1. `CURATION_MAX_ARTICLES=0` (`0` means uncapped)
   2. `MAX_ARTICLES_PER_SOURCE=40`

6. Run final QA gate:

```bash
npm run qa
```

## GitHub Secret Wiring

The workflow already maps the secret into runtime env:
1. `/Users/jaybharti/Documents/RSS Feed/.github/workflows/curate.yml` sets:
   1. `KIMI_CODE_API: ${{ secrets.KIMI_CODE_API }}`
   2. `GEOTAG_MODE` configurable via repo variable (defaults to `auto`)
   3. `GEOTAG_MAX_API_BATCHES` configurable via repo variable (defaults to `0` for uncapped)
2. `/Users/jaybharti/Documents/RSS Feed/src/config.js` reads `process.env.KIMI_CODE_API`.
3. `/Users/jaybharti/Documents/RSS Feed/src/geotagger.js` switches to live Kimi when key exists; otherwise it uses mock geotagging.

Verification in Actions logs:
1. Step `Validate secret wiring` should print `KIMI_CODE_API detected in environment.` once you add the secret.
2. Pipeline log line should include `hasKimiKey:true`.
3. If Kimi is not rate-limited, `geotagModeResolved` should be `live`; otherwise fallback may show `mock` with a `429` warning (still confirms secret wiring).

Kimi troubleshooting:
1. `429` responses: usually quota/rate-limit issues.
2. `401 invalid_authentication_error`: key missing/invalid/expired.
3. Logs now include structured API error details and quota violation hints from API responses.

## Implemented Modules (Phases 0-3)

- `src/config.js`: environment and runtime configuration.
- `src/utils.js`: logger, timeout helpers, text and URL utilities.
- `src/fetcher.js`: RSS ingestion, normalization, deduplication.
- `src/extractor.js`: content extraction with fallback chain.
- `src/curator.js`: scoring, exclusion filters, top article selection.
- `src/index.js`: orchestration entrypoint through Phase 5 (`runPhaseOneToFive`).

## Implemented Modules (Phase 4)

- `src/geotagger.js`: mock/live geotagging, Kimi integration, retry/backoff, response validation, and fallback category logic.

## Implemented Modules (Phase 5)

- `src/persistence.js`: output schema normalization and artifact writing (`articles.json`, `lastUpdated.txt`).
- `.github/workflows/curate.yml`: workflow now commits generated artifacts back to `main`.

## Implemented Modules (Phase 6)

- `index.html`: responsive dashboard shell with map + grid layout + native reader overlay + refresh controls.
- `assets/styles.css`: AMOLED theme, responsive layout, card animations, and reader styles.
- `assets/app.js`: data loading, map/category/tag filters, GitHub workflow refresh trigger/polling, native article reader, and Read Later localStorage.
- `assets/map.js`: Leaflet map + marker clustering + country click filtering + centroid fallback coordinates.
- `assets/markdown.js`: safe markdown renderer used by the in-app reader.
- `assets/world.geo.json`: world country boundaries used for map highlighting/filtering.
- `logbook.html`, `assets/logbook.js`, `assets/logbook.css`: clean static logbook reader for `AGENT_PROGRESS_LOG.md`.

## Implemented Modules (Phase 7)

- `scripts/qa-check.mjs`: automated schema/quality/performance sanity checks for generated artifacts.
- `.github/workflows/curate.yml`: workflow now runs `npm run qa` after pipeline and before artifact commit.
- Geotag hardening in `src/geotagger.js`: structured API diagnostics, fallback model chain, and max live-request guard.

## Notes For Next Agent

1. Read `PHASED_IMPLEMENTATION_PLAN.md` and `AGENT_PROGRESS_LOG.md` before coding.
2. Continue from maintenance tasks using current output shape from `runPhaseOneToFive()`.
3. Use `PHASE_SIGNOFF.md` for signed-off scope and exact next-start checklist.
