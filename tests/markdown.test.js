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
