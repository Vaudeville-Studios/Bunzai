import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseDocsIndex } from "../docs/corpus";
import type { DocFigure, DocRecord } from "../docs/types";
import { buildDocumentationSite } from "./documentation";

const root = resolve(import.meta.dir, "../..");

describe("standalone documentation build", () => {
  test("emits every indexed page with the bundled anchors, navigation, and local figure assets", () => {
    const index = parseDocsIndex(JSON.parse(readFileSync(join(root, "docs/generated/docs-index.json"), "utf8")) as unknown);
    const figures = JSON.parse(readFileSync(join(root, "docs/generated/figures.json"), "utf8")) as DocFigure[];
    expect(index).not.toBeNull();
    const docs = index!.docs;
    const site = buildDocumentationSite(root, index!, figures, (doc) => readFileSync(join(root, doc.path), "utf8"));
    const pages = new Map(site.pages.map((page) => [page.path, page]));
    expect(site.pages).toHaveLength(docs.length + 1);
    expect(pages.get("docs/index.html")?.body).toContain("Browse the complete library");
    for (const doc of docs) {
      const path = `docs/${doc.id.split("/").map(encodeURIComponent).join("/")}.html`;
      const page = pages.get(path);
      expect(page, `missing static page for ${doc.id}`).toBeDefined();
      expect(page!.body).toContain('aria-label="Documentation pages"');
      for (const anchor of flatten(doc.anchors)) {
        expect(page!.body, `missing generated anchor ${doc.id}#${anchor.slug}`).toContain(`id="doc-${anchor.slug}"`);
      }
    }
    for (const page of site.pages) {
      const localDocLinks = [...page.body.matchAll(/href="(\/Bunzai\/docs\/[^"#]+)(?:#[^"]*)?"/g)].map((match) => match[1]!);
      for (const href of localDocLinks) {
        const target = decodeURI(href.slice("/Bunzai/".length));
        if (target.endsWith(".html")) expect(pages.has(target), `broken local docs link ${href}`).toBe(true);
        else expect(existsSync(join(root, target)), `broken local docs asset ${href}`).toBe(true);
      }
    }
    const gettingStarted = pages.get("docs/guide/getting-started.html")?.body ?? "";
    expect(gettingStarted).toContain("/Bunzai/docs/generated/figures/");
    expect(gettingStarted).toContain("Open full-size image");
  }, 15_000);

  test("sanitizes raw markup and keeps indexed links and figures inside the Docs routes", () => {
    const scratch = mkdtempSync(join(tmpdir(), "bunzai-docs-site-"));
    try {
      mkdirSync(join(scratch, "docs", "guide"), { recursive: true });
      mkdirSync(join(scratch, "docs", "generated", "figures"), { recursive: true });
      writeFileSync(join(scratch, "docs", "generated", "figures", "guide__plan.svg"), "<svg></svg>");
      const record = (id: string, path: string, anchors: DocRecord["anchors"]): DocRecord => ({
        id, path, title: id, audience: "user", summary: "A page", tags: [], related: [],
        semanticSummary: "", topics: [], anchors,
      });
      const first = record("guide/first", "docs/guide/first.md", [{ text: "Choices", slug: "choices", level: 2, summary: "", topics: [], children: [] }]);
      const second = record("guide/second", "docs/guide/second.md", [{ text: "More", slug: "more", level: 2, summary: "", topics: [], children: [] }]);
      const figure: DocFigure = { file: "guide.js", figid: "plan", type: "flow", title: "Plan", caption: "A safe figure", svg: "docs/generated/figures/guide__plan.svg", w: 20, h: 10 };
      const docs = [first, second];
      const site = buildDocumentationSite(scratch, { generated: "test", count: 2, docs }, [figure], (doc) => doc.id === first.id
        ? "---\ntitle: first\n---\n# First\n\n## Choices\n\n[Next](second.md#more)\n\n@fig plan\n\n<script>window.pwned = true</script>\n\n[Unsafe](javascript:alert(1))"
        : "# Second\n\n## More\n\nText");
      const page = site.pages.find((item) => item.id === first.id)!.body;
      expect(page).toContain('href="/Bunzai/docs/guide/second.html#doc-more"');
      expect(page).toContain('id="doc-choices"');
      expect(page).toContain('src="/Bunzai/docs/generated/figures/guide__plan.svg"');
      expect(page).not.toContain("window.pwned");
      expect(page).not.toContain('href="javascript:');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

function flatten(anchors: DocRecord["anchors"]): { slug: string }[] {
  return anchors.flatMap((anchor) => [{ slug: anchor.slug }, ...flatten(anchor.children)]);
}
