import { initializeMap } from "./map.js";

const READ_LATER_KEY = "rss_news_hub_read_later_v1";
const CATEGORIES = ["All", "World", "National", "Trending", "WorthReading"];

const state = {
  metadata: null,
  allArticles: [],
  selectedCountry: null,
  selectedCategory: "All",
  searchQuery: "",
  readLaterOnly: false,
  readLaterIds: new Set()
};

const elements = {
  lastUpdated: document.querySelector("#last-updated"),
  stats: document.querySelector("#stats"),
  searchInput: document.querySelector("#search-input"),
  categoryFilters: document.querySelector("#category-filters"),
  readLaterOnlyToggle: document.querySelector("#read-later-only"),
  clearCountryButton: document.querySelector("#clear-country-filter"),
  selectedCountryLabel: document.querySelector("#selected-country-label"),
  articlesGrid: document.querySelector("#articles-grid"),
  mapToggle: document.querySelector("#map-toggle"),
  mapPanel: document.querySelector("#map-panel")
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

function updateSelectedCountryLabel() {
  elements.selectedCountryLabel.textContent = state.selectedCountry
    ? `Country filter: ${state.selectedCountry}`
    : "Country filter: All countries";
}

function toggleReadLater(id) {
  if (state.readLaterIds.has(id)) {
    state.readLaterIds.delete(id);
  } else {
    state.readLaterIds.add(id);
  }

  persistReadLater();
  render();
}

function createCategoryButtons() {
  elements.categoryFilters.innerHTML = CATEGORIES.map((category) => {
    const active = state.selectedCategory === category;
    return `<button class="chip ${active ? "active" : ""}" data-category="${category}">${category}</button>`;
  }).join("");
}

function applyFilters() {
  const search = state.searchQuery.trim().toLowerCase();
  const byCategoryAndQuery = state.allArticles.filter((article) => {
    const categoryMatch =
      state.selectedCategory === "All" || article.category === state.selectedCategory;
    if (!categoryMatch) {
      return false;
    }

    if (!search) {
      return true;
    }

    const haystack = `${article.title} ${article.excerpt} ${article.sourceName}`.toLowerCase();
    return haystack.includes(search);
  });

  const byReadLater = byCategoryAndQuery.filter((article) => {
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

  elements.stats.innerHTML = `
    <div class="stat"><span class="label">Total</span><span class="value">${total}</span></div>
    <div class="stat"><span class="label">Visible</span><span class="value">${filteredCount}</span></div>
    <div class="stat"><span class="label">Read Later</span><span class="value">${saved}</span></div>
    <div class="stat"><span class="label">AI Fallback</span><span class="value">${fallbackMode}</span></div>
  `;
}

function renderArticles(articles) {
  if (articles.length === 0) {
    elements.articlesGrid.innerHTML = `
      <div class="empty-state">
        <h3>No articles match current filters</h3>
        <p>Try clearing country/category/search filters.</p>
      </div>
    `;
    return;
  }

  elements.articlesGrid.innerHTML = articles
    .map((article, index) => {
      const saved = state.readLaterIds.has(article.id);
      const city = article.geotag?.city ? `, ${article.geotag.city}` : "";

      return `
        <article class="news-card" style="--delay:${Math.min(index * 18, 220)}ms">
          <header>
            <div class="meta-row">
              <span class="source">${escapeHtml(article.sourceName)}</span>
              <span class="category category-${escapeHtml(article.category)}">${escapeHtml(
                article.category
              )}</span>
            </div>
            <h3><a href="${escapeHtml(article.url)}" target="_blank" rel="noreferrer">${escapeHtml(
              article.title
            )}</a></h3>
          </header>
          <p>${escapeHtml(article.excerpt)}</p>
          <footer>
            <span>${escapeHtml(article.geotag?.country || "UNK")}${escapeHtml(city)}</span>
            <span>${formatDate(article.publishedAt)}</span>
            <button class="save-btn ${saved ? "saved" : ""}" data-save-id="${escapeHtml(
              article.id
            )}">
              ${saved ? "Saved" : "Read Later"}
            </button>
          </footer>
        </article>
      `;
    })
    .join("");
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
    const button = event.target.closest("button[data-save-id]");
    if (!button) {
      return;
    }

    const articleId = button.dataset.saveId;
    if (!articleId) {
      return;
    }

    toggleReadLater(articleId);
  });

  elements.mapToggle.addEventListener("click", () => {
    elements.mapPanel.classList.toggle("collapsed");
    const collapsed = elements.mapPanel.classList.contains("collapsed");
    elements.mapToggle.textContent = collapsed ? "Show Map" : "Hide Map";
  });
}

function render(mapController) {
  createCategoryButtons();
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
