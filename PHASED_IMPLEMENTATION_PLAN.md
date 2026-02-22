# RSS News Hub - Phased Implementation Plan (v1)

## Purpose
This document converts the original TSD into an executable, phase-by-phase plan that can be built safely over multiple sessions and handed off between agents without losing context.

## What We Are Building
A GitHub Actions-driven RSS news pipeline that:
1. Fetches and normalizes articles from configured feeds.
2. Extracts readable content with fallbacks.
3. Scores and curates top stories.
4. Geotags and categorizes stories using Gemini API.
5. Publishes `articles.json` for a static GitHub Pages dashboard.
6. Renders an interactive map + article grid with local "Read Later" state.

## Gaps Found In The Original TSD (Decisions Applied)
1. Gemini endpoint/model naming is likely stale (`gemini-3-flash-preview` in the PDF). We will verify current model names during implementation and keep the model configurable through env.
2. TSD includes brittle paywall bypass steps (`12ft.io`, `archive.today`). We will implement them as optional fallbacks behind strict timeout controls, with graceful degradation to headline/excerpt only.
3. File naming in sections is inconsistent (`curation.js` vs `curator.js`). We will standardize on the repository layout shown in Section 5.
4. Geocoding from country/city to coordinates is not fully specified. We will maintain a small deterministic lookup for common countries/cities and use country centroids when city precision is unavailable.

## Security Policy (Must Follow)
1. Never commit API keys.
2. Use `process.env.GEMINI_API_KEY` only.
3. Commit a `.env.example` template, never `.env`.
4. Add secret-related ignore patterns in `.gitignore`.
5. Use GitHub Actions secrets for production execution.
6. Keep repository private if desired, but still treat secrets as exposed if committed once (rotation required).

## Phase Plan

### Phase 0 - Foundation and Guardrails
Scope:
1. Create repository skeleton from TSD Section 5.
2. Add `package.json`, baseline scripts, `.gitignore`, `.env.example`, `README.md`.
3. Add central config loading and environment validation.
4. Add logging/error utility modules.

Deliverables:
1. Folder structure and stubs compile in Node 18.
2. `npm run lint`/`npm run test` placeholders defined.
3. Security baseline in docs.

Exit Criteria:
1. `node src/index.js` runs with no syntax/runtime boot errors.
2. Missing `GEMINI_API_KEY` fails with clear message (only where required).

### Phase 1 - Feed Ingestion
Scope:
1. Implement `config/sources.json` (up to 9 feeds).
2. Build `src/fetcher.js` using `rss-parser`.
3. Normalize article metadata to internal schema.
4. Apply initial deduplication by URL.
5. Enforce per-source cap (10 articles).

Deliverables:
1. Deterministic ingestion output.
2. Unit tests for dedupe and per-source limits.

Exit Criteria:
1. Ingestion returns valid normalized objects.
2. Duplicate URLs are removed consistently.

### Phase 2 - Content Extraction Pipeline
Scope:
1. Implement extraction chain in `src/extractor.js`.
2. Attempt direct fetch + Readability.
3. Optional fallbacks (12ft/archive), each bounded by per-attempt and global timeouts.
4. Fallback to excerpt-only data if full extraction fails.
5. Convert cleaned HTML to markdown with max content length controls.

Deliverables:
1. Extraction result object with `content`, `wordCount`, `readTime`.
2. Robust timeout and retry handling.

Exit Criteria:
1. No single article blocks pipeline progression.
2. Failed extraction still yields usable article record.

### Phase 3 - Curation and Ranking
Scope:
1. Implement exclusion regex and scoring in `src/curator.js`.
2. Apply source-tier and quality weights.
3. Remove low-value entries.
4. Select top 40 items.

Deliverables:
1. Transparent scoring function.
2. Test coverage for clickbait filtering and ranking behavior.

Exit Criteria:
1. Final set maxes at 40.
2. Quality gates from TSD are respected.

### Phase 4 - Geotagging + Category Assignment
Scope:
1. Implement batch geotagging call in `src/geotagger.js`.
2. Strict JSON validation and fallback defaults when LLM output is malformed.
3. Map country/city to coordinates.
4. Post-process categories with deterministic fallback logic.

Deliverables:
1. Geotag enrichment on curated set.
2. Backoff/retry on 429/5xx responses.

Exit Criteria:
1. Pipeline continues even if Gemini partially fails.
2. Each output article has category and a geotag object.

### Phase 5 - Persistence + Orchestration
Scope:
1. Implement `src/index.js` orchestration.
2. Write `articles.json` and `lastUpdated.txt`.
3. Add metadata block and output schema enforcement.
4. Add `.github/workflows/curate.yml` manual workflow.

Deliverables:
1. End-to-end command for local run.
2. Actions workflow that commits updated data.

Exit Criteria:
1. Running pipeline produces valid `articles.json`.
2. GitHub Action can run manually and commit artifacts.

### Phase 6 - Frontend Dashboard
Scope:
1. Build `index.html`, `assets/styles.css`, `assets/app.js`, `assets/map.js`.
2. Render article grid + filters + map.
3. Integrate Leaflet tiles and marker clustering.
4. Add localStorage-based Read Later.
5. Ensure responsive breakpoints and map interactions.

Deliverables:
1. Usable dashboard on desktop/tablet/mobile.
2. Country click filters corresponding articles.

Exit Criteria:
1. Page loads and fetches `articles.json`.
2. Read Later persists across reloads.

### Phase 7 - Hardening, QA, and Handoff Docs
Scope:
1. Validate checklist items from TSD Section 6.
2. Add smoke tests and schema checks.
3. Performance pass for output size/runtime.
4. Finalize maintenance documentation and next-agent handoff.

Deliverables:
1. QA report with pass/fail and known gaps.
2. Updated runbook for future contributors.

Exit Criteria:
1. No blocker defects.
2. Documentation complete enough for cold-start handoff.

## Documentation Rules for Every Phase
At phase completion, update:
1. `AGENT_PROGRESS_LOG.md`
2. `README.md` (setup/run changes)
3. Any relevant module-level docs/comments

Each phase sign-off entry must include:
1. Date/time (UTC).
2. Files changed.
3. What is done.
4. What is intentionally deferred.
5. Exact next starting point for the next agent.

## Recommended Execution Order
1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7

## Current Status
1. Planning complete (this document).
2. Phases 0-6 implemented.
3. Next actionable phase: Phase 7.
