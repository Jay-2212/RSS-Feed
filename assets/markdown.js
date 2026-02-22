function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

export function renderMarkdown(markdown) {
  const source = String(markdown ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!source) {
    return "<p>No content extracted for this article.</p>";
  }

  const lines = source.split("\n");
  const out = [];
  const unordered = [];
  const ordered = [];

  function flushUnordered() {
    if (unordered.length === 0) {
      return;
    }
    out.push(`<ul>${unordered.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    unordered.length = 0;
  }

  function flushOrdered() {
    if (ordered.length === 0) {
      return;
    }
    out.push(`<ol>${ordered.map((item) => `<li>${item}</li>`).join("")}</ol>`);
    ordered.length = 0;
  }

  function flushLists() {
    flushUnordered();
    flushOrdered();
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushLists();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushLists();
      const level = Math.min(6, headingMatch[1].length);
      out.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushOrdered();
      unordered.push(renderInlineMarkdown(unorderedMatch[1]));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushUnordered();
      ordered.push(renderInlineMarkdown(orderedMatch[1]));
      continue;
    }

    if (/^---+$/.test(line)) {
      flushLists();
      out.push("<hr />");
      continue;
    }

    flushLists();
    out.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  flushLists();
  return out.join("");
}
