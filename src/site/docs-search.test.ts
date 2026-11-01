import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { runDocsSearch } from "./docs-search";

test("search applies text entered while the docs index is still loading", async () => {
  const root = resolve(import.meta.dir, "../..");
  const index = readFileSync(join(root, "docs/generated/docs-index.json"), "utf8");
  const dom = new JSDOM(`<div data-doc-search data-index-href="/Bunzai/docs/docs-index.json" data-doc-root="/Bunzai/docs/">
    <form role="search" data-doc-search-form><label for="query">Search docs</label><input id="query" type="search"></form>
    <p data-doc-search-status role="status">Search loads when JavaScript is available.</p><ol data-doc-search-results hidden></ol>
  </div>`, { url: "https://example.test/Bunzai/docs/index.html" });
  const input = dom.window.document.querySelector<HTMLInputElement>("input[type=search]")!;
  const results = dom.window.document.querySelector<HTMLOListElement>("[data-doc-search-results]")!;
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = Object.assign(() => new Promise<Response>((resolve) => { release = resolve; }), {
    preconnect: originalFetch.preconnect,
  });
  try {
    runDocsSearch(dom.window.document);
    input.value = `Bun ${readFileSync(join(root, ".bun-version"), "utf8").trim()}`;
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    expect(results.childElementCount).toBe(0);
    release(new Response(index, { status: 200, headers: { "content-type": "application/json" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...results.querySelectorAll("a")].some((link) => link.href.endsWith("/guide/installation.html"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
