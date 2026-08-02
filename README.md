# RSS News Hub

RSS News Hub is a personal Node.js pipeline and static dashboard. It reads RSS
feeds, fetches article pages, extracts and normalizes readable content, curates
the result, optionally geotags it with an AI provider, and writes JSON artifacts
for a GitHub Pages-style frontend.

**Status:** the pipeline and dashboard are implemented and maintained as a
personal project. The repository also contains generated article excerpts,
fuller extracted content, image URLs, and research PDFs from third parties. It
is therefore not a source-code-only open-source content bundle; see
[CONTENT_LICENSE.md](CONTENT_LICENSE.md) before redistributing it.

## What it does

- Fetches configured RSS sources from `config/sources.json`.
- Normalizes feeds and removes duplicate URLs/titles.
- Extracts readable article text with publisher-specific fallbacks.
- Curates articles using source tier, word-count, title, and exclusion signals.
- Persists article metadata, content, images, feed cache state, and run history.
- Adds deterministic fallback geotags, or optional AI geotags through Inception
  Labs and Gemini configuration.
- Serves a static dashboard with map, filters, article cards, a reader, and
  local Read Later state.
- Runs schema, quality, and performance checks before the GitHub Actions job
  commits generated artifacts.

The dashboard is a reading and organization tool. It does not verify the
accuracy of publisher content, geotags, categories, priority labels, or AI
annotations.

## Data and content rights

The generated `articles.json` contains publisher-derived titles, excerpts,
extracted article content, and image URLs. The repository also contains PDFs and
other documentation that may be subject to their authors' or publishers' terms.
Jay does not claim ownership of that material, and the repository's future code
licence (if selected) must not be read as a licence for the fetched content.

Before publishing a deployment or a redistributed fork, review the terms of
each source, consider reducing the stored text to permitted excerpts/links, and
remove or regenerate the checked-in artifacts as appropriate. See
[CONTENT_LICENSE.md](CONTENT_LICENSE.md).

## Local setup

Requirements:

- Node.js 18 or newer;
- npm; and
- network access to the configured RSS sources and, when enabled, the chosen AI
  provider.

```bash
git clone https://github.com/Jay-2212/RSS-Feed.git
cd RSS-Feed
npm ci
npm test
npm run lint
npm run qa
```

Run the full pipeline locally with:

```bash
npm run run:pipeline
```

The pipeline writes `articles.json`, `lastUpdated.txt`, `feedState.json`, and
`runHistory.json` in the repository root by default. Those are generated data,
not source code.

## Configuration and secrets

Copy `.env.example` to `.env` for local-only configuration. `.env` is ignored by
Git. The current implementation uses these AI variables:

- `INCEPTION_API_KEY`, `INCEPTION_BASE_URL`, `INCEPTION_MODEL`;
- `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL`; and
- `GEOTAG_MODE`, `GEOTAG_BATCH_SIZE`, `GEOTAG_MAX_API_BATCHES`.

When `GEOTAG_MODE=auto`, the pipeline can fall back to deterministic/mock
geotagging if an AI key is absent or a provider call fails. Do not put real keys
in `.env.example`, source files, generated artifacts, issue reports, or GitHub
history. Use GitHub Actions repository secrets for the workflow.

## GitHub Actions

`.github/workflows/curate.yml` is a manual `workflow_dispatch` job. It:

1. checks out the repository;
2. uses Node.js 18 and `npm ci`;
3. reads `INCEPTION_API_KEY` and `GEMINI_API_KEY` from repository secrets;
4. runs `npm run run:pipeline` and `npm run qa`; and
5. commits changed generated artifacts to `main` as `github-actions[bot]`.

Review that write-back behavior before enabling the workflow on a fork. The
workflow has permission to write repository contents.

## Project layout

```text
src/                 Pipeline, fetching, extraction, curation, geotagging
scripts/             Lint and QA checks
tests/               Node test suite
assets/              Static dashboard JavaScript, CSS, map, and reader helpers
config/sources.json  RSS source configuration
articles.json        Generated article snapshot; third-party-content concern
```

## Limitations and privacy

- Publisher HTML, RSS schemas, robots rules, rate limits, and URLs can change.
- The extractor uses external publisher pages and fallback services; review
  their terms before operating the pipeline at scale.
- Stored content and image links can remain in Git history even after a later
  regeneration; remove sensitive or infringing artifacts deliberately.
- AI geotags and classifications can be wrong and should be reviewed.
- The dashboard has no account or server-side access-control layer in this
  repository.
- Local browser Read Later state is not a synchronized backup.

## Contributing

Issues and pull requests are welcome for reproducible parser failures, schema
regressions, safer defaults, test coverage, and documentation. Include the
source ID and a synthetic/minimal example where possible. Do not include API
keys, private feed credentials, copyrighted article copies, or personal logs.

## Licence status

No project-wide licence is asserted while the repository contains generated
publisher content and other materials with separate rights. The absence of a
root licence should be treated as intentional until the code/data split and
ownership review are complete.
