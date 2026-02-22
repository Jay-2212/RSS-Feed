import { renderMarkdown } from "./markdown.js";

const elements = {
  content: document.querySelector("#logbook-content"),
  meta: document.querySelector("#logbook-meta")
};

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadLogbook() {
  const response = await fetch("AGENT_PROGRESS_LOG.md");
  if (!response.ok) {
    throw new Error(`Unable to load AGENT_PROGRESS_LOG.md (${response.status})`);
  }

  const markdown = await response.text();
  elements.content.innerHTML = renderMarkdown(markdown);

  const lastModified = response.headers.get("last-modified");
  elements.meta.textContent = `Last modified: ${formatDate(lastModified)}`;
}

loadLogbook().catch((error) => {
  elements.content.innerHTML = `<p>${String(error.message || "Failed to load logbook.")}</p>`;
  elements.meta.textContent = "Last modified: unavailable";
});
