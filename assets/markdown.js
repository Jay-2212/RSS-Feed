function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveUrl(rawUrl, baseUrl) {
  const candidate = String(rawUrl ?? "").trim();
  if (!candidate) {
    return null;
  }

  try {
    const resolved = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function renderImage(altText, url, options) {
  const resolved = resolveUrl(url, options.baseUrl);
  if (!resolved) {
    return "";
  }

  return `<figure><img src="${escapeHtml(
    resolved
  )}" alt="${escapeHtml(altText || "Article image")}" loading="lazy" referrerpolicy="no-referrer" /></figure>`;
}

function renderInlineMarkdown(text, options) {
  let html = escapeHtml(text);

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    return renderImage(alt, url, options);
  });

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    const resolved = resolveUrl(url, options.baseUrl);
    if (!resolved) {
      return escapeHtml(label);
    }
    return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
      label
    )}</a>`;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

export function renderMarkdown(markdown, options = {}) {
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
      out.push(`<h${level}>${renderInlineMarkdown(headingMatch[2], options)}</h${level}>`);
      continue;
    }

    const imageOnlyMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageOnlyMatch) {
      flushLists();
      out.push(renderImage(imageOnlyMatch[1], imageOnlyMatch[2], options));
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushOrdered();
      unordered.push(renderInlineMarkdown(unorderedMatch[1], options));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushUnordered();
      ordered.push(renderInlineMarkdown(orderedMatch[1], options));
      continue;
    }

    if (/^---+$/.test(line)) {
      flushLists();
      out.push("<hr />");
      continue;
    }

    flushLists();
    out.push(`<p>${renderInlineMarkdown(line, options)}</p>`);
  }

  flushLists();
  return out.join("");
}
