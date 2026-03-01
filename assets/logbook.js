import { renderMarkdown } from "./markdown.js";

const elements = {
  content: document.querySelector("#logbook-content"),
  meta: document.querySelector("#logbook-meta"),
  btnProgress: document.querySelector("#nav-progress"),
  btnHistory: document.querySelector("#nav-history")
};

let currentTab = "progress";

function formatDate(value, full = true) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  if (!full) {
    return parsed.toLocaleDateString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function fetchProgress() {
  const response = await fetch("AGENT_PROGRESS_LOG.md");
  if (!response.ok) {
    throw new Error(`Unable to load AGENT_PROGRESS_LOG.md (${response.status})`);
  }
  const text = await response.text();
  const lastModified = response.headers.get("last-modified");
  return { text, lastModified };
}

async function fetchHistory() {
  const response = await fetch("runHistory.json");
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Unable to load runHistory.json (${response.status})`);
  }
  return response.json();
}

function renderHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "<p>No run history found. Run the pipeline to generate logs.</p>";
  }

  const rows = history.map((entry) => {
    const modeClass = `badge-${String(entry.geotagModeResolved || "unknown").toLowerCase()}`;
    
    return `
      <tr>
        <td style="white-space:nowrap">${formatDate(entry.timestamp, false)}</td>
        <td>
          <span class="badge ${modeClass}">${entry.geotagModeResolved || "Unknown"}</span>
          <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;">${entry.geotagModel || "-"}</div>
        </td>
        <td>
          <div class="status-summary">
            <div class="status-item">
              <span class="status-label">Fetched</span>
              <span class="status-value">${entry.fetched ?? 0}</span>
            </div>
            <div class="status-item">
              <span class="status-label">New Tagged</span>
              <span class="status-value">${entry.geotaggedNew ?? 0}</span>
            </div>
            <div class="status-item">
              <span class="status-label">Total Articles</span>
              <span class="status-value">${entry.articlesPersisted ?? 0}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="status-summary" style="font-size:0.75rem">
            <div class="status-item">
              <span class="status-label">Unchanged</span>
              <span class="status-value">${entry.unchangedSources ?? 0}</span>
            </div>
            <div class="status-item">
              <span class="status-label">Failed</span>
              <span class="status-value" style="color:${(entry.failedSources || 0) > 0 ? "#b91c1c" : "inherit"}">${entry.failedSources ?? 0}</span>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div class="history-table-container">
      <table class="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Geotag Mode</th>
            <th>Article Stats</th>
            <th>Feed Stats</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

async function updateView(tab = currentTab) {
  currentTab = tab;
  
  elements.btnProgress.classList.toggle("active", tab === "progress");
  elements.btnHistory.classList.toggle("active", tab === "history");
  
  elements.content.innerHTML = "<p>Loading...</p>";

  try {
    if (tab === "progress") {
      const { text, lastModified } = await fetchProgress();
      elements.content.innerHTML = renderMarkdown(text);
      elements.meta.textContent = `Last modified: ${formatDate(lastModified)}`;
    } else {
      const history = await fetchHistory();
      elements.content.innerHTML = renderHistory(history);
      elements.meta.textContent = `${history.length} runs recorded`;
    }
  } catch (error) {
    elements.content.innerHTML = `<p class="error">${String(error.message || "Failed to load content.")}</p>`;
    elements.meta.textContent = "Error loading content";
  }
}

elements.btnProgress.addEventListener("click", () => updateView("progress"));
elements.btnHistory.addEventListener("click", () => updateView("history"));

// Initial load
updateView("progress");
