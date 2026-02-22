import { renderMarkdown } from "./markdown.js";
import { initializeMap } from "./map.js";

const READ_LATER_KEY = "rss_news_hub_read_later_v1";
const BASE_CATEGORY_ORDER = ["World", "National", "Trending", "WorthReading"];

const state = {
  metadata: null,
  allArticles: [],
  selectedCountry: null,
  selectedCategory: "All",
  selectedTag: "All",
  searchQuery: "",
  readLaterOnly: false,
  readLaterIds: new Set(),
  activeArticleId: null
};

const elements = {
  lastUpdated: document.querySelector("#last-updated"),
  stats: document.querySelector("#stats"),
  searchInput: document.querySelector("#search-input"),
  categoryFilters: document.querySelector("#category-filters"),
  tagFilters: document.querySelector("#tag-filters"),
  readLaterOnlyToggle: document.querySelector("#read-later-only"),
  clearCountryButton: document.querySelector("#clear-country-filter"),
  selectedCountryLabel: document.querySelector("#selected-country-label"),
  articlesGrid: document.querySelector("#articles-grid"),
  mapToggle: document.querySelector("#map-toggle"),
  mapPanel: document.querySelector("#map-panel"),
  readerOverlay: document.querySelector("#reader-overlay"),
  readerClose: document.querySelector("#reader-close"),
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
    for (const tag of articleTags(article)) {
      const normalized = String(tag).trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map((entry) => entry[0]);
}

function updateSelectedCountryLabel() {
  elements.selectedCountryLabel.textContent = state.selectedCountry
    ? `Country filter: ${state.selectedCountry}`
    : "Country filter: All countries";
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
  const entries = ["All", ...tags];

  elements.tagFilters.innerHTML = entries
    .map((tag) => {
      const active = state.selectedTag === tag;
      return `
        <button class="chip chip-topic ${active ? "active" : ""}" data-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
        </button>
      `;
    })
    .join("");

  if (!entries.includes(state.selectedTag)) {
    state.selectedTag = "All";
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
      state.selectedTag === "All" || tags.map((value) => value.toLowerCase()).includes(state.selectedTag);
    if (!tagMatch) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = `${article.title} ${article.excerpt} ${article.sourceName} ${tags.join(" ")} ${
      article.geotag?.country || ""
    } ${article.geotag?.city || ""}`.toLowerCase();

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

  elements.stats.innerHTML = `
    <div class="stat"><span class="label">Total</span><span class="value">${total}</span></div>
    <div class="stat"><span class="label">Visible</span><span class="value">${filteredCount}</span></div>
    <div class="stat"><span class="label">Tagged</span><span class="value">${tagged}</span></div>
    <div class="stat"><span class="label">Read Later</span><span class="value">${saved}</span></div>
    <div class="stat"><span class="label">AI Fallback</span><span class="value">${fallbackMode}</span></div>
    <div class="stat"><span class="label">Data Mode</span><span class="value">Snapshot</span></div>
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
              <span class="category category-${escapeHtml(article.category)}">${escapeHtml(
                article.category
              )}</span>
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
  document.body.classList.remove("reader-open");
}

function openReader(articleId) {
  const article = state.allArticles.find((candidate) => candidate.id === articleId);
  if (!article) {
    return;
  }

  state.activeArticleId = article.id;
  const city = article.geotag?.city ? `, ${article.geotag.city}` : "";
  const tags = articleTags(article);
  const readerBody = article.content?.trim()
    ? renderMarkdown(article.content)
    : `<p>${escapeHtml(article.excerpt || "No extracted content available.")}</p>`;

  elements.readerTitle.textContent = article.title;
  elements.readerMeta.innerHTML = `
    <span>${escapeHtml(article.sourceName)}</span>
    <span>${formatDate(article.publishedAt)}</span>
    <span>${escapeHtml(article.geotag?.country || "UNK")}${escapeHtml(city)}</span>
    ${tags.length > 0 ? `<span>${escapeHtml(tags.join(" • "))}</span>` : ""}
  `;
  elements.readerContent.innerHTML = readerBody;
  elements.readerOverlay.classList.add("visible");
  document.body.classList.add("reader-open");
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
    const button = event.target.closest("button[data-tag]");
    if (!button) {
      return;
    }

    state.selectedTag = button.dataset.tag || "All";
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

  elements.mapToggle.addEventListener("click", () => {
    elements.mapPanel.classList.toggle("collapsed");
    const collapsed = elements.mapPanel.classList.contains("collapsed");
    elements.mapToggle.textContent = collapsed ? "Show Map" : "Hide Map";
    setTimeout(() => {
      mapController.resize();
    }, 120);
  });

  elements.readerClose.addEventListener("click", () => {
    closeReader();
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
  renderArticles(filtered.gridArticles);
  mapController.update(filtered.mapArticles);
}

async function bootstrap() {
  state.readLaterIds = loadReadLater();

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

  const response = await fetch("articles.json");
  if (!response.ok) {
    throw new Error(`Unable to load articles.json (${response.status})`);
  }

  const payload = await response.json();
  state.metadata = payload.metadata || null;
  state.allArticles = Array.isArray(payload.articles) ? payload.articles : [];

  if (elements.lastUpdated) {
    elements.lastUpdated.textContent = formatDate(state.metadata?.lastUpdated);
  }

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
});
