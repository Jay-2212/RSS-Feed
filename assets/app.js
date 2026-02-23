import { renderMarkdown } from "./markdown.js";
import { initializeMap } from "./map.js";

const READ_LATER_KEY = "rss_news_hub_read_later_v1";
const GITHUB_TOKEN_KEY = "rss_news_hub_github_pat_v1";
const BASE_CATEGORY_ORDER = ["World", "National", "Trending", "WorthReading"];
const REFRESH_POLL_INTERVAL_MS = 7_000;
const REFRESH_MAX_POLLS = 60;

const state = {
  metadata: null,
  allArticles: [],
  selectedCountry: null,
  selectedCategory: "All",
  selectedTagKey: "all",
  searchQuery: "",
  readLaterOnly: false,
  readLaterIds: new Set(),
  activeArticleId: null,
  refreshing: false
};

const workflowConfig = {
  owner: document.body.dataset.githubOwner || "",
  repo: document.body.dataset.githubRepo || "",
  workflow: document.body.dataset.githubWorkflow || "",
  ref: document.body.dataset.githubRef || "main"
};

const elements = {
  lastUpdated: document.querySelector("#last-updated"),
  topStats: document.querySelector("#top-stats"),
  refreshButton: document.querySelector("#refresh-button"),
  refreshStatus: document.querySelector("#refresh-status"),
  searchInput: document.querySelector("#search-input"),
  categoryFilters: document.querySelector("#category-filters"),
  tagFilters: document.querySelector("#tag-filters"),
  readLaterOnlyToggle: document.querySelector("#read-later-only"),
  clearCountryButton: document.querySelector("#clear-country-filter"),
  mapFullscreenButton: document.querySelector("#map-fullscreen"),
  selectedCountryLabel: document.querySelector("#selected-country-label"),
  priorityStrip: document.querySelector("#priority-strip"),
  articlesGrid: document.querySelector("#articles-grid"),
  mapToggle: document.querySelector("#map-toggle"),
  mapPanel: document.querySelector("#map-panel"),
  readerOverlay: document.querySelector("#reader-overlay"),
  readerPanel: document.querySelector("#reader-panel"),
  readerClose: document.querySelector("#reader-close"),
  readerFullscreen: document.querySelector("#reader-fullscreen"),
  readerTitle: document.querySelector("#reader-title"),
  readerMeta: document.querySelector("#reader-meta"),
  readerContent: document.querySelector("#reader-content")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "Unknown time";
  }
}

function normalizeTagKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizePriority(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["high", "critical", "urgent"].includes(normalized)) {
    return "High";
  }
  if (["low", "minor", "routine"].includes(normalized)) {
    return "Low";
  }
  return "Medium";
}

function hasConflictSignal(article) {
  if (article?.signals?.conflict) {
    return true;
  }
  const tags = articleTags(article);
  return tags.some((tag) => /\b(conflict|war|ceasefire|military|attack)\b/i.test(tag));
}

function resolveHttpUrl(rawUrl, baseUrl = "") {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function upgradeImageUrlForDisplay(rawUrl) {
  const source = String(rawUrl ?? "").trim();
  if (!source) {
    return null;
  }

  let upgraded = source;
  if (/th-i\.thgim\.com/i.test(upgraded)) {
    upgraded = upgraded.replace(
      /\/alternates\/SQUARE_(?:80|120|160)\//i,
      "/alternates/LANDSCAPE_1200/"
    );
  }

  try {
    const parsed = new URL(upgraded);

    const width = Number.parseInt(parsed.searchParams.get("width") || "", 10);
    if (Number.isFinite(width) && width > 0 && width < 1200) {
      parsed.searchParams.set("width", "1200");
    }

    const w = Number.parseInt(parsed.searchParams.get("w") || "", 10);
    if (Number.isFinite(w) && w > 0 && w < 1200) {
      parsed.searchParams.set("w", "1200");
    }

    const resizeMatch = String(parsed.searchParams.get("resize") || "").match(/^(\d+),(\d+)$/);
    if (resizeMatch) {
      const currentWidth = Number.parseInt(resizeMatch[1], 10);
      const currentHeight = Number.parseInt(resizeMatch[2], 10);
      if (
        Number.isFinite(currentWidth) &&
        currentWidth > 0 &&
        Number.isFinite(currentHeight) &&
        currentHeight > 0 &&
        currentWidth < 1200
      ) {
        const scaledHeight = Math.max(1, Math.round((currentHeight * 1200) / currentWidth));
        parsed.searchParams.set("resize", `1200,${scaledHeight}`);
      }
    }

    return parsed.toString();
  } catch {
    return upgraded;
  }
}

function loadReadLater() {
  try {
    const raw = localStorage.getItem(READ_LATER_KEY);
    const parsed = JSON.parse(raw || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistReadLater() {
  localStorage.setItem(READ_LATER_KEY, JSON.stringify(Array.from(state.readLaterIds)));
}

function articleTags(article) {
  return Array.isArray(article?.tags) ? article.tags : [];
}

function categoriesFromArticles() {
  const dynamic = new Set(
    state.allArticles
      .map((article) => String(article.category || "").trim())
      .filter(Boolean)
  );

  const ordered = ["All"];
  for (const category of BASE_CATEGORY_ORDER) {
    if (dynamic.has(category)) {
      ordered.push(category);
      dynamic.delete(category);
    }
  }

  return ordered.concat(Array.from(dynamic).sort((a, b) => a.localeCompare(b)));
}

function topTagsFromArticles(limit = 14) {
  const counts = new Map();
  for (const article of state.allArticles) {
    for (const labelRaw of articleTags(article)) {
      const label = String(labelRaw || "").trim();
      const key = normalizeTagKey(label);
      if (!key) {
        continue;
      }

      const entry = counts.get(key) || { key, label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

function updateSelectedCountryLabel() {
  elements.selectedCountryLabel.textContent = state.selectedCountry
    ? `Country filter: ${state.selectedCountry}`
    : "Country filter: All countries";
}

function setRefreshStatus(message, isError = false) {
  if (!elements.refreshStatus) {
    return;
  }
  elements.refreshStatus.textContent = message || "";
  elements.refreshStatus.classList.toggle("error", Boolean(isError));
}

function updateRefreshButton() {
  if (!elements.refreshButton) {
    return;
  }

  elements.refreshButton.disabled = state.refreshing;
  elements.refreshButton.textContent = state.refreshing ? "Refreshing..." : "Refresh";
}

function toggleReadLater(id, mapController) {
  if (state.readLaterIds.has(id)) {
    state.readLaterIds.delete(id);
  } else {
    state.readLaterIds.add(id);
  }

  persistReadLater();
  render(mapController);
}

function createCategoryButtons() {
  const categories = categoriesFromArticles();
  elements.categoryFilters.innerHTML = categories
    .map((category) => {
      const active = state.selectedCategory === category;
      return `
        <button class="chip ${active ? "active" : ""}" data-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `;
    })
    .join("");

  if (!categories.includes(state.selectedCategory)) {
    state.selectedCategory = "All";
  }
}

function createTagButtons() {
  const tags = topTagsFromArticles();
  const entries = [{ key: "all", label: "All" }, ...tags];

  elements.tagFilters.innerHTML = entries
    .map((entry) => {
      const active = state.selectedTagKey === entry.key;
      return `
        <button class="chip chip-topic ${active ? "active" : ""}" data-tag-key="${escapeHtml(
          entry.key
        )}">
          ${escapeHtml(entry.label)}
        </button>
      `;
    })
    .join("");

  if (!entries.some((entry) => entry.key === state.selectedTagKey)) {
    state.selectedTagKey = "all";
  }
}

function applyFilters() {
  const search = state.searchQuery.trim().toLowerCase();

  const filteredByPrimary = state.allArticles.filter((article) => {
    const categoryMatch =
      state.selectedCategory === "All" || article.category === state.selectedCategory;
    if (!categoryMatch) {
      return false;
    }

    const tags = articleTags(article);
    const tagMatch =
      state.selectedTagKey === "all" ||
      tags.some((tag) => normalizeTagKey(tag) === state.selectedTagKey);
    if (!tagMatch) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = `${article.title} ${article.excerpt} ${article.sourceName} ${tags.join(" ")} ${
      article.geotag?.country || ""
    } ${article.geotag?.city || ""} ${article.priority || ""} ${
      article?.signals?.conflict ? "conflict" : ""
    }`.toLowerCase();

    return haystack.includes(search);
  });

  const byReadLater = filteredByPrimary.filter((article) => {
    if (!state.readLaterOnly) {
      return true;
    }
    return state.readLaterIds.has(article.id);
  });

  const countryFiltered = byReadLater.filter((article) => {
    if (!state.selectedCountry) {
      return true;
    }
    return article.geotag?.country === state.selectedCountry;
  });

  return {
    mapArticles: byReadLater,
    gridArticles: countryFiltered
  };
}

function renderStats(filteredCount) {
  const total = state.allArticles.length;
  const saved = state.readLaterIds.size;
  const geotagMode = state.metadata?.geotagModeResolved || "unknown";
  const fallbackMode = geotagMode === "mock" ? "Yes" : "No";
  const tagged = state.allArticles.filter((article) => articleTags(article).length > 0).length;
  const highPriorityCount = state.allArticles.filter(
    (article) => normalizePriority(article.priority) === "High"
  ).length;

  elements.topStats.innerHTML = `
    <div class="stat"><span class="label">Total</span><span class="value">${total}</span></div>
    <div class="stat"><span class="label">Visible</span><span class="value">${filteredCount}</span></div>
    <div class="stat"><span class="label">Tagged</span><span class="value">${tagged}</span></div>
    <div class="stat"><span class="label">High Priority</span><span class="value">${highPriorityCount}</span></div>
    <div class="stat"><span class="label">Read Later</span><span class="value">${saved}</span></div>
    <div class="stat"><span class="label">AI Fallback</span><span class="value">${fallbackMode}</span></div>
  `;
}

function renderArticleTags(tags) {
  if (!tags || tags.length === 0) {
    return "";
  }

  return `
    <div class="article-tags">
      ${tags
        .slice(0, 5)
        .map((tag) => `<span class="article-tag">${escapeHtml(tag)}</span>`)
        .join("")}
    </div>
  `;
}

function renderPriorityStrip(articles) {
  if (!elements.priorityStrip) {
    return;
  }

  const prioritized = [...articles]
    .filter(
      (article) => normalizePriority(article.priority) === "High" || hasConflictSignal(article)
    )
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8);

  if (prioritized.length === 0) {
    elements.priorityStrip.innerHTML = `
      <div class="empty-priority">
        High-priority briefing is clear for current filters.
      </div>
    `;
    return;
  }

  elements.priorityStrip.innerHTML = `
    <div class="priority-list">
      ${prioritized
        .map((article) => {
          const country = article?.geotag?.country || "UNK";
          const priority = normalizePriority(article.priority);
          const conflict = hasConflictSignal(article);
          return `
            <article class="priority-item">
              <button data-open-id="${escapeHtml(article.id)}">${escapeHtml(article.title)}</button>
              <div class="meta">
                ${escapeHtml(priority)} Priority • ${escapeHtml(country)} • ${
                  conflict ? "Conflict Signal" : "General Alert"
                }
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderArticles(articles) {
  if (articles.length === 0) {
    elements.articlesGrid.innerHTML = `
      <div class="empty-state">
        <h3>No articles match current filters</h3>
        <p>Try clearing country/category/tag/search filters.</p>
      </div>
    `;
    return;
  }

  elements.articlesGrid.innerHTML = articles
    .map((article, index) => {
      const saved = state.readLaterIds.has(article.id);
      const city = article.geotag?.city ? `, ${article.geotag.city}` : "";
      const tags = articleTags(article);

      return `
        <article class="news-card" style="--delay:${Math.min(index * 18, 220)}ms">
          <header>
            <div class="meta-row">
              <span class="source">${escapeHtml(article.sourceName)}</span>
              <div class="meta-badges">
                <span class="priority-badge priority-${escapeHtml(normalizePriority(article.priority))}">
                  ${escapeHtml(normalizePriority(article.priority))}
                </span>
                <span class="category category-${escapeHtml(article.category)}">${escapeHtml(
                  article.category
                )}</span>
              </div>
            </div>
            <h3>
              <button class="title-btn" data-open-id="${escapeHtml(article.id)}">
                ${escapeHtml(article.title)}
              </button>
            </h3>
          </header>
          <p>${escapeHtml(article.excerpt)}</p>
          ${renderArticleTags(tags)}
          <footer>
            <span>${escapeHtml(article.geotag?.country || "UNK")}${escapeHtml(city)}</span>
            <span>${formatDate(article.publishedAt)}</span>
            <div class="card-actions">
              <button class="open-btn" data-open-id="${escapeHtml(article.id)}">Read Here</button>
              <button class="save-btn ${saved ? "saved" : ""}" data-save-id="${escapeHtml(article.id)}">
                ${saved ? "Saved" : "Read Later"}
              </button>
            </div>
          </footer>
        </article>
      `;
    })
    .join("");
}

function closeReader() {
  state.activeArticleId = null;
  elements.readerOverlay.classList.remove("visible");
  elements.readerOverlay.setAttribute("aria-hidden", "true");
  elements.readerPanel.classList.remove("reader-panel-maximized");
  document.body.classList.remove("reader-open");

  if (document.fullscreenElement === elements.readerPanel) {
    document.exitFullscreen().catch(() => {});
  }
}

function openReader(articleId) {
  const article = state.allArticles.find((candidate) => candidate.id === articleId);
  if (!article) {
    return;
  }

  state.activeArticleId = article.id;
  const city = article.geotag?.city ? `, ${article.geotag.city}` : "";
  const tags = articleTags(article);
  const heroUrl = resolveHttpUrl(upgradeImageUrlForDisplay(article.imageUrl), article.url);
  const heroImage = heroUrl
    ? `<figure><img src="${escapeHtml(heroUrl)}" alt="${escapeHtml(
        article.title
      )}" loading="lazy" decoding="async" referrerpolicy="strict-origin-when-cross-origin" /></figure>`
    : "";
  const readerBody = article.content?.trim()
    ? renderMarkdown(article.content, { baseUrl: article.url })
    : `<p>${escapeHtml(article.excerpt || "No extracted content available.")}</p>`;

  elements.readerTitle.textContent = article.title;
  elements.readerMeta.innerHTML = `
    <span>${escapeHtml(article.sourceName)}</span>
    <span>${formatDate(article.publishedAt)}</span>
    <span>${escapeHtml(article.geotag?.country || "UNK")}${escapeHtml(city)}</span>
    ${tags.length > 0 ? `<span>${escapeHtml(tags.join(" • "))}</span>` : ""}
  `;
  elements.readerContent.innerHTML = `${heroImage}${readerBody}`;
  elements.readerOverlay.classList.add("visible");
  elements.readerOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("reader-open");
}

async function toggleReaderFullscreen() {
  if (!elements.readerPanel) {
    return;
  }

  if (document.fullscreenElement === elements.readerPanel) {
    await document.exitFullscreen();
    return;
  }

  if (elements.readerPanel.requestFullscreen) {
    try {
      await elements.readerPanel.requestFullscreen();
      return;
    } catch {
      // Fallback to CSS maximized mode below.
    }
  }

  elements.readerPanel.classList.toggle("reader-panel-maximized");
}

async function toggleMapFullscreen(mapController) {
  const panel = elements.mapPanel;
  if (!panel) {
    return;
  }

  if (document.fullscreenElement === panel) {
    await document.exitFullscreen();
    return;
  }

  if (panel.requestFullscreen) {
    try {
      await panel.requestFullscreen();
    } catch {
      // Ignore fullscreen rejection.
    }
  }

  setTimeout(() => {
    mapController.resize();
  }, 120);
}

function hasWorkflowConfig() {
  return Boolean(workflowConfig.owner && workflowConfig.repo && workflowConfig.workflow);
}

function getStoredGitHubToken() {
  try {
    return String(localStorage.getItem(GITHUB_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function storeGitHubToken(token) {
  try {
    localStorage.setItem(GITHUB_TOKEN_KEY, String(token || "").trim());
  } catch {
    // Ignore localStorage failures.
  }
}

function clearGitHubToken() {
  try {
    localStorage.removeItem(GITHUB_TOKEN_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}

async function ensureGitHubToken({ interactive = false } = {}) {
  const stored = getStoredGitHubToken();
  if (stored) {
    return stored;
  }

  if (!interactive) {
    return "";
  }

  const entered = window.prompt(
    "To run a fresh pipeline now, enter a GitHub token (PAT) with Actions/Workflows access. This is separate from Kimi API key. Leave blank to reload current snapshot only."
  );
  const token = String(entered || "").trim();
  if (!token) {
    return "";
  }

  storeGitHubToken(token);
  return token;
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function triggerWorkflowDispatch(token) {
  await githubRequest(
    `/repos/${encodeURIComponent(workflowConfig.owner)}/${encodeURIComponent(
      workflowConfig.repo
    )}/actions/workflows/${encodeURIComponent(workflowConfig.workflow)}/dispatches`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: workflowConfig.ref
      })
    }
  );

  return new Date().toISOString();
}

async function findDispatchedRunId(token, startedAtIso) {
  const startedAtMs = new Date(startedAtIso).getTime();

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const runsResponse = await githubRequest(
      `/repos/${encodeURIComponent(workflowConfig.owner)}/${encodeURIComponent(
        workflowConfig.repo
      )}/actions/workflows/${encodeURIComponent(workflowConfig.workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(
        workflowConfig.ref
      )}&per_page=20`,
      token
    );

    const runs = Array.isArray(runsResponse?.workflow_runs) ? runsResponse.workflow_runs : [];
    const matched = runs.find((run) => {
      const createdAtMs = new Date(run.created_at || "").getTime();
      return Number.isFinite(createdAtMs) && createdAtMs >= startedAtMs - 20_000;
    });

    if (matched) {
      return matched.id;
    }

    await sleep(3_000);
  }

  throw new Error("Workflow dispatch accepted, but no run was found yet.");
}

async function waitForWorkflowCompletion(token, runId) {
  for (let pollIndex = 0; pollIndex < REFRESH_MAX_POLLS; pollIndex += 1) {
    const run = await githubRequest(
      `/repos/${encodeURIComponent(workflowConfig.owner)}/${encodeURIComponent(
        workflowConfig.repo
      )}/actions/runs/${encodeURIComponent(runId)}`,
      token
    );

    const status = String(run?.status || "").toLowerCase();
    const conclusion = String(run?.conclusion || "").toLowerCase();

    if (status === "completed") {
      if (conclusion === "success") {
        return;
      }
      throw new Error(`Workflow finished with status: ${conclusion || "failed"}.`);
    }

    setRefreshStatus(`Workflow is ${status || "in progress"}...`);
    await sleep(REFRESH_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out while waiting for workflow completion.");
}

async function loadArticles({ forceNetwork = false } = {}) {
  const cacheBuster = forceNetwork ? `?t=${Date.now()}` : "";
  const response = await fetch(`articles.json${cacheBuster}`, {
    cache: forceNetwork ? "no-store" : "default"
  });
  if (!response.ok) {
    throw new Error(`Unable to load articles.json (${response.status})`);
  }

  const payload = await response.json();
  state.metadata = payload.metadata || null;
  state.allArticles = Array.isArray(payload.articles) ? payload.articles : [];

  if (elements.lastUpdated) {
    elements.lastUpdated.textContent = formatDate(state.metadata?.lastUpdated);
  }
}

async function runRefresh(mapController) {
  if (state.refreshing) {
    return;
  }

  state.refreshing = true;
  updateRefreshButton();
  const previousTimestamp = state.metadata?.lastUpdated || "";

  try {
    let workflowTriggered = false;

    if (hasWorkflowConfig()) {
      const token = await ensureGitHubToken({ interactive: true });
      if (token) {
        setRefreshStatus("Starting workflow run...");
        const startedAt = await triggerWorkflowDispatch(token);
        const runId = await findDispatchedRunId(token, startedAt);
        setRefreshStatus(`Workflow run #${runId} started.`);
        await waitForWorkflowCompletion(token, runId);
        workflowTriggered = true;
      } else {
        setRefreshStatus(
          "No GitHub token provided. Reloading current snapshot only (no new pipeline run)."
        );
      }
    }

    await loadArticles({ forceNetwork: true });
    render(mapController);
    mapController.resize();

    if (state.metadata?.lastUpdated && state.metadata.lastUpdated !== previousTimestamp) {
      setRefreshStatus(`Updated: ${formatDate(state.metadata.lastUpdated)}`);
    } else if (workflowTriggered) {
      setRefreshStatus("Workflow completed, but the snapshot timestamp is unchanged.");
    } else {
      setRefreshStatus(`Snapshot reloaded: ${formatDate(state.metadata?.lastUpdated)}`);
    }
  } catch (error) {
    if (/GitHub API 401|GitHub API 403/i.test(String(error?.message || ""))) {
      clearGitHubToken();
    }
    setRefreshStatus(error.message || "Refresh failed.", true);
  } finally {
    state.refreshing = false;
    updateRefreshButton();
  }
}

function setupEvents(mapController) {
  elements.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value || "";
    render(mapController);
  });

  elements.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button) {
      return;
    }

    state.selectedCategory = button.dataset.category || "All";
    render(mapController);
  });

  elements.tagFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tag-key]");
    if (!button) {
      return;
    }

    state.selectedTagKey = button.dataset.tagKey || "all";
    render(mapController);
  });

  elements.readLaterOnlyToggle.addEventListener("change", (event) => {
    state.readLaterOnly = Boolean(event.target.checked);
    render(mapController);
  });

  elements.clearCountryButton.addEventListener("click", () => {
    state.selectedCountry = null;
    mapController.clearSelection();
    render(mapController);
  });

  elements.articlesGrid.addEventListener("click", (event) => {
    const saveButton = event.target.closest("button[data-save-id]");
    if (saveButton) {
      const articleId = saveButton.dataset.saveId;
      if (articleId) {
        toggleReadLater(articleId, mapController);
      }
      return;
    }

    const openButton = event.target.closest("button[data-open-id]");
    if (openButton) {
      const articleId = openButton.dataset.openId;
      if (articleId) {
        openReader(articleId);
      }
    }
  });

  elements.priorityStrip?.addEventListener("click", (event) => {
    const openButton = event.target.closest("button[data-open-id]");
    if (!openButton) {
      return;
    }
    const articleId = openButton.dataset.openId;
    if (articleId) {
      openReader(articleId);
    }
  });

  elements.mapToggle.addEventListener("click", () => {
    elements.mapPanel.classList.toggle("collapsed");
    const collapsed = elements.mapPanel.classList.contains("collapsed");
    elements.mapToggle.textContent = collapsed ? "Show Map" : "Hide Map";
    setTimeout(() => {
      mapController.resize();
    }, 120);
  });

  elements.mapFullscreenButton?.addEventListener("click", async () => {
    await toggleMapFullscreen(mapController);
  });

  elements.refreshButton.addEventListener("click", async () => {
    await runRefresh(mapController);
  });

  elements.readerClose.addEventListener("click", () => {
    closeReader();
  });

  elements.readerFullscreen.addEventListener("click", async () => {
    await toggleReaderFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement !== elements.readerPanel) {
      elements.readerPanel.classList.remove("reader-panel-maximized");
    }

    if (elements.mapFullscreenButton) {
      elements.mapFullscreenButton.textContent =
        document.fullscreenElement === elements.mapPanel ? "Exit Map" : "Full Map";
    }

    mapController.resize();
  });

  elements.readerOverlay.addEventListener("click", (event) => {
    if (event.target === elements.readerOverlay) {
      closeReader();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeArticleId) {
      closeReader();
    }
  });
}

function render(mapController) {
  createCategoryButtons();
  createTagButtons();
  updateSelectedCountryLabel();

  const filtered = applyFilters();
  renderStats(filtered.gridArticles.length);
  renderPriorityStrip(filtered.gridArticles);
  renderArticles(filtered.gridArticles);
  mapController.update(filtered.mapArticles);
}

async function bootstrap() {
  state.readLaterIds = loadReadLater();
  updateRefreshButton();

  const mapController = initializeMap({
    elementId: "world-map",
    onCountrySelect(countryCode) {
      state.selectedCountry = countryCode;
      render(mapController);
    },
    onCountryClear() {
      state.selectedCountry = null;
      render(mapController);
    }
  });

  setupEvents(mapController);
  await loadArticles({ forceNetwork: true });

  render(mapController);
  mapController.resize();
}

bootstrap().catch((error) => {
  if (elements.articlesGrid) {
    elements.articlesGrid.innerHTML = `
      <div class="empty-state">
        <h3>Dashboard failed to load</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
  setRefreshStatus(error.message || "Dashboard failed to load.", true);
});
