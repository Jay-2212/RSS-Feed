import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../assets/markdown.js";

test("renderMarkdown embeds tweet iframe from blockquote tweet links", () => {
  const markdown = `
> Forecast update:
> — NWS (@NWSWPC) [February 22, 2026](https://twitter.com/NWSWPC/status/2025559764030402568?ref_src=twsrc%5Etfw)
`;

  const html = renderMarkdown(markdown, {});
  assert.match(html, /twitframe\.com\/show\?url=/);
  assert.match(html, /https%3A%2F%2Fx\.com%2FNWSWPC%2Fstatus%2F2025559764030402568/);
});

test("renderMarkdown uses permissive referrer policy for images", () => {
  const markdown = "![Hero](https://example.com/image.jpg)";
  const html = renderMarkdown(markdown, {});

  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(html, /decoding="async"/);
});

test("renderMarkdown supports underscore emphasis markers", () => {
  const markdown = "The _Financial Times_ and _Ahimsa_ markers should render.";
  const html = renderMarkdown(markdown, {});

  assert.match(html, /<em>Financial Times<\/em>/);
  assert.match(html, /<em>Ahimsa<\/em>/);
});

test("renderMarkdown renders linked images without leaking escaped figure markup", () => {
  const markdown = "[![Hero](https://example.com/image.jpg)](https://example.com/story)";
  const html = renderMarkdown(markdown, {});

  assert.match(html, /<a href="https:\/\/example\.com\/story"/);
  assert.match(html, /<img src="https:\/\/example\.com\/image\.jpg"/);
  assert.doesNotMatch(html, /&lt;figure&gt;/);
});

test("renderMarkdown renders standalone image URLs as images", () => {
  const markdown = "https://example.com/article-image.webp";
  const html = renderMarkdown(markdown, {});

  assert.match(html, /<img src="https:\/\/example\.com\/article-image\.webp"/);
});
