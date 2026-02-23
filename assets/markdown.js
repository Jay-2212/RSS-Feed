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

function isPlaceholderImageUrl(url) {
  return /(1x1_spacer|grey-placeholder|placeholder|blank|pixel|transparent)/i.test(
    String(url ?? "")
  );
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

function normalizeTweetStatusUrl(rawUrl, baseUrl) {
  const resolved = resolveUrl(rawUrl, baseUrl);
  if (!resolved) {
    return null;
  }

  const match = resolved.match(
    /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/status\/(\d+)/i
  );
  if (!match) {
    return null;
  }

  return `https://x.com/${match[1]}/status/${match[2]}`;
}

function extractTweetStatusUrl(text, baseUrl) {
  const source = String(text ?? "");
  const markdownLinkMatches = source.matchAll(/\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g);
  for (const match of markdownLinkMatches) {
    const normalized = normalizeTweetStatusUrl(match?.[1], baseUrl);
    if (normalized) {
      return normalized;
    }
  }

  const plainMatch = source.match(
    /(https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/status\/\d+[^\s)]*)/i
  );
  if (!plainMatch) {
    return null;
  }

  return normalizeTweetStatusUrl(plainMatch[1], baseUrl);
}

function renderTweetEmbed(tweetUrl) {
  const encodedUrl = encodeURIComponent(tweetUrl);
  return `
    <figure class="tweet-embed">
      <iframe
        src="https://twitframe.com/show?url=${encodedUrl}"
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups"
        title="Embedded post"
      ></iframe>
      <figcaption>
        <a href="${escapeHtml(tweetUrl)}" target="_blank" rel="noreferrer noopener">Open post</a>
      </figcaption>
    </figure>
  `;
}

function renderImage(altText, url, options) {
  const resolved = resolveUrl(url, options.baseUrl);
  const upgraded = resolved ? upgradeImageUrlForDisplay(resolved) : null;
  const finalUrl = resolveUrl(upgraded, options.baseUrl);
  if (!finalUrl || isPlaceholderImageUrl(finalUrl)) {
    return "";
  }

  return `<figure><img src="${escapeHtml(
    finalUrl
  )}" alt="${escapeHtml(
    altText || "Article image"
  )}" loading="lazy" decoding="async" referrerpolicy="strict-origin-when-cross-origin" /></figure>`;
}

function renderInlineMarkdown(text, options) {
  const imageTokens = [];
  let staged = String(text ?? "");

  staged = staged.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt, url) => {
    const imageHtml = renderImage(alt, url, options);
    if (!imageHtml) {
      return "";
    }
    const token = `@@IMG_TOKEN_${imageTokens.length}@@`;
    imageTokens.push({ token, html: imageHtml });
    return token;
  });

  let html = escapeHtml(staged);

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
  html = html.replace(
    /(^|[\s([{>])_([^_\n]+?)_(?=$|[\s)\]}<.,!?;:])/g,
    (_match, prefix, body) => `${prefix}<em>${body}</em>`
  );

  for (const token of imageTokens) {
    html = html.split(token.token).join(token.html);
  }

  return html;
}

function stripLeadingIndianExpressBreadcrumbs(markdown, baseUrl) {
  if (!/indianexpress\.com/i.test(String(baseUrl || ""))) {
    return markdown;
  }

  const lines = String(markdown ?? "").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  let breadcrumbCount = 0;
  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      break;
    }

    const match = line.match(/^(\d+)\.\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/i);
    if (!match) {
      break;
    }

    const label = match[2].trim().toLowerCase();
    const link = match[3].trim().toLowerCase();
    const looksBreadcrumbLabel =
      /^(home|news|world|national|india|cities|opinion|business|technology|science|sports|us news|global|politics|explained)$/.test(
        label
      );
    const looksBreadcrumbUrl =
      link.includes("indianexpress.com/section/") || link === "https://indianexpress.com/";

    if (!looksBreadcrumbLabel && !looksBreadcrumbUrl) {
      break;
    }

    breadcrumbCount += 1;
    cursor += 1;
  }

  if (breadcrumbCount < 2) {
    return markdown;
  }

  if (cursor < lines.length && /^\d+\.\s+/.test(lines[cursor].trim())) {
    cursor += 1;
  }
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  return lines.slice(cursor).join("\n");
}

function normalizeMarkdownSource(markdown, baseUrl) {
  let normalized = String(markdown ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u200b-\u200f\ufeff\u2060]/g, "")
    .replace(/!\[([^\]\n]{0,240})\s*\n\]\((https?:\/\/[^)\s]+(?:\?[^)\s]+)?)(?:\s+"[^"]*")?\)/g, "![$1]($2)")
    .replace(/!\[([^\]\n]{0,240})\]\s*\n\((https?:\/\/[^)\s]+(?:\?[^)\s]+)?)(?:\s+"[^"]*")?\)/g, "![$1]($2)");

  normalized = stripLeadingIndianExpressBreadcrumbs(normalized, baseUrl);
  return normalized;
}

function extractStandaloneImageUrl(line, baseUrl) {
  const match = String(line ?? "")
    .trim()
    .match(/^<?(https?:\/\/[^\s>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s>]*)?)>?$/i);
  if (!match) {
    return null;
  }

  return resolveUrl(match[1], baseUrl);
}

export function renderMarkdown(markdown, options = {}) {
  const source = normalizeMarkdownSource(markdown, options.baseUrl).trim();
  if (!source) {
    return "<p>No content extracted for this article.</p>";
  }

  const lines = source.split("\n");
  const out = [];
  const unordered = [];
  const ordered = [];
  const blockquote = [];

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

  function flushBlockquote() {
    if (blockquote.length === 0) {
      return;
    }

    const lines = blockquote.map((line) => line.replace(/^>\s?/, "").trim()).filter(Boolean);
    const merged = lines.join(" ");
    const tweetUrl = extractTweetStatusUrl(merged, options.baseUrl);

    if (tweetUrl) {
      out.push(renderTweetEmbed(tweetUrl));
    } else if (lines.length > 0) {
      out.push(
        `<blockquote>${lines.map((line) => renderInlineMarkdown(line, options)).join("<br />")}</blockquote>`
      );
    }

    blockquote.length = 0;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushLists();
      flushBlockquote();
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushLists();
      blockquote.push(line);
      continue;
    }

    flushBlockquote();

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

    const directImageUrl = extractStandaloneImageUrl(line, options.baseUrl);
    if (directImageUrl) {
      flushLists();
      out.push(renderImage("Article image", directImageUrl, options));
      continue;
    }

    const standaloneTweetUrl =
      line.includes("status/") && /^[\[\]().:\-_\sA-Za-z0-9/=?&%#]*$/.test(line)
        ? extractTweetStatusUrl(line, options.baseUrl)
        : null;
    if (standaloneTweetUrl && !/\s[a-zA-Z]{3,}\s/.test(line.replace(standaloneTweetUrl, "").trim())) {
      flushLists();
      out.push(renderTweetEmbed(standaloneTweetUrl));
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
  flushBlockquote();
  return out.join("");
}
