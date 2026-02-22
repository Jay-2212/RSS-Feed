# RSS News Hub

A phased implementation of a personal RSS news aggregator that runs on GitHub Actions and serves a static dashboard through GitHub Pages.

## Current Build Status

- Completed phases: 0, 1, 2, 3, 4
- In progress: none
- Next phase: 5 (Persistence + workflow artifact commit)

## Security Rules

1. Never hardcode API keys in source code.
2. Keep secrets in GitHub Actions repository secrets.
3. Use `GEMINI_API_KEY` from environment variables only.
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

5. Run Phase 1-4 pipeline:

```bash
npm run run:pipeline
```

By default this runs Phase 1-4. Geotag behavior:
1. `GEOTAG_MODE=auto`: uses Gemini when `GEMINI_API_KEY` exists, otherwise mock geotagging.
2. `GEOTAG_MODE=mock`: always mock geotagging.
3. `GEOTAG_MODE=live`: forces Gemini API geotagging (requires key).

## GitHub Secret Wiring

The workflow already maps the secret into runtime env:
1. `/Users/jaybharti/Documents/RSS Feed/.github/workflows/curate.yml` sets:
   1. `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}`
   2. `GEOTAG_MODE: auto`
2. `/Users/jaybharti/Documents/RSS Feed/src/config.js` reads `process.env.GEMINI_API_KEY`.
3. `/Users/jaybharti/Documents/RSS Feed/src/geotagger.js` switches to live Gemini when key exists; otherwise it uses mock geotagging.

Verification in Actions logs:
1. Step `Validate secret wiring` should print `GEMINI_API_KEY detected in environment.` once you add the secret.
2. Pipeline log line should include `hasGeminiKey:true`.
3. If Gemini is not rate-limited, `geotagModeResolved` should be `live`; otherwise fallback may show `mock` with a `429` warning (still confirms secret wiring).

## Implemented Modules (Phases 0-3)

- `src/config.js`: environment and runtime configuration.
- `src/utils.js`: logger, timeout helpers, text and URL utilities.
- `src/fetcher.js`: RSS ingestion, normalization, deduplication.
- `src/extractor.js`: content extraction with fallback chain.
- `src/curator.js`: scoring, exclusion filters, top article selection.
- `src/index.js`: orchestration entrypoint through Phase 4 (`runPhaseOneToFour`).

## Implemented Modules (Phase 4)

- `src/geotagger.js`: mock/live geotagging, Gemini integration, retry/backoff, response validation, and fallback category logic.
- `.github/workflows/curate.yml`: GitHub Actions wiring that reads `GEMINI_API_KEY` from repository secrets.

## Planned Next Modules

- `.github/workflows/curate.yml`: workflow commit/publish enhancements (Phase 5).
- Static frontend in `index.html` + `assets/*` (Phase 6).

## Notes For Next Agent

1. Read `PHASED_IMPLEMENTATION_PLAN.md` and `AGENT_PROGRESS_LOG.md` before coding.
2. Continue from Phase 5 using current output shape from `runPhaseOneToFour()`.
3. Use `PHASE_SIGNOFF.md` for signed-off scope and exact next-start checklist.
