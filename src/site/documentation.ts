/** Static Pages presentation of the committed bundled DocsIndex corpus. */
import { existsSync } from "node:fs";
import { JSDOM } from "jsdom";
import type { DocFigure, DocRecord, DocsIndex } from "../docs/types";
import { resolveDocAsset, resolveDocPage } from "../docs/corpus";
import { escapeHtml } from "../ui/_shared/render-policy";
import { renderMarkup } from "../ui/_shared/render-markup";
import { RENDER_INPUT_CAP } from "../ui/_shared/render-policy";
import { displayDocTitle, groupDocs, prepareDocSegments } from "../ui/apps/docs/docs-core";
import { flattenAnchors } from "../kit/docs/navigation";

export interface DocumentationPage {
  readonly path: string;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
}

export interface DocumentationSite {
  readonly pages: readonly DocumentationPage[];
  readonly searchIndex: string;
}

const ROOT = "/Bunzai/";
const SITE_MARKDOWN_CHUNK = Math.floor(RENDER_INPUT_CAP / 2);

export function docRoute(id: string): string {
  const encoded = id.split("/").map(encodeURIComponent).join("/");
  return `${ROOT}docs/${encoded}.html`;
}

function safeWindow<T>(render: () => T): T {
  const dom = new JSDOM("", { url: "https://docs.invalid/" });
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window as unknown as Window });
  try { return render(); }
  finally {
    if (prior) Object.defineProperty(globalThis, "window", prior);
    else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
}

function navGroups(index: DocsIndex, activeId: string): string {
  return groupDocs(index.docs).map((group) => {
    const activeGroup = group.sections.some((section) => section.docs.some((doc) => doc.id === activeId));
    const sections = group.sections.map((section) => {
      const activeSection = section.docs.some((doc) => doc.id === activeId);
      const links = section.docs.map((doc) => `<li><a href="${docRoute(doc.id)}"${doc.id === activeId ? ' aria-current="page"' : ""}>${escapeHtml(displayDocTitle(doc))}</a></li>`).join("");
      return `<details${activeSection ? " open" : ""}><summary>${escapeHtml(section.label)} <span>${section.docs.length}</span></summary><ul>${links}</ul></details>`;
    }).join("");
    return `<details class="docs-group"${activeGroup || !activeId ? " open" : ""}><summary>${escapeHtml(group.label)}</summary>${sections}</details>`;
  }).join("");
}

function toc(record: DocRecord): string {
  const anchors = flattenAnchors(record.anchors);
  if (!anchors.length) return `<p class="docs-toc-empty">This page has no section links.</p>`;
  return `<ol>${anchors.map((anchor) => `<li class="level-${anchor.level}"><a href="#doc-${encodeURIComponent(anchor.slug)}">${escapeHtml(anchor.text)}</a></li>`).join("")}</ol>`;
}

function articleBody(root: string, index: DocsIndex, figures: DocFigure[], record: DocRecord, markdown: string): string {
  const segments = prepareDocSegments(markdown, record, index.docs, figures, {
    docHref: (id, anchor) => `${docRoute(id)}${anchor ? `#doc-${encodeURIComponent(anchor)}` : ""}`,
    localAnchorHref: (anchor) => `#doc-${encodeURIComponent(anchor)}`,
  });
  const content = segments.map((segment) => {
    if (segment.kind === "markdown") return renderMarkdown(segment.body);
    const resolved = resolveDocAsset(root, segment.path);
    if (!resolved || !existsSync(resolved)) throw new Error(`docs: figure asset is missing or outside the public roots: ${segment.path}`);
    const assetPath = segment.path.replaceAll("\\", "/");
    const asset = `${ROOT}${assetPath}`;
    const size = segment.width && segment.height ? ` width="${segment.width}" height="${segment.height}"` : "";
    return `<figure class="docs-figure"><a href="${asset}" target="_blank" rel="noopener noreferrer" aria-label="Open full-size image: ${escapeHtml(segment.alt)}"><img src="${asset}" alt="${escapeHtml(segment.alt)}"${size} loading="lazy"></a>${segment.caption ? `<figcaption>${escapeHtml(segment.caption)}</figcaption>` : ""}</figure>`;
  }).join("");
  const articleUp = "../".repeat(record.id.split("/").length);
  return `<div class="docs-layout" data-doc-search data-index-href="${articleUp}docs/docs-index.json" data-doc-root="${ROOT}docs/">
<aside class="docs-sidebar"><a class="docs-index-link" href="${ROOT}docs/index.html">All documentation</a>${searchControls()}<nav aria-label="Documentation pages">${navGroups(index, record.id)}</nav></aside>
<article class="docs-article"><p class="docs-crumb"><a href="${ROOT}docs/index.html">Docs</a> / ${escapeHtml(record.audience === "user" ? "User" : "Developer")} / ${escapeHtml(displayDocTitle(record))}</p><div class="doc docs-content">${content}</div><nav class="docs-pager" aria-label="Page navigation">${relatedLinks(record, index.docs)}</nav></article>
<aside class="docs-toc" aria-label="On this page"><h2>On this page</h2>${toc(record)}</aside>
</div>`;
}

function renderMarkdown(markdown: string): string {
  const chunks: string[] = [];
  let lines: string[] = [];
  let length = 0;
  let inFence = false;
  let reopenFence = false;
  const flush = (): void => {
    if (!lines.length) return;
    const body = `${reopenFence ? "```\n" : ""}${lines.join("\n")}${inFence ? "\n```" : ""}`;
    chunks.push(renderMarkup(body, "markdown"));
    lines = [];
    length = 0;
    reopenFence = inFence;
  };
  for (const line of markdown.split("\n")) {
    if (line.length > SITE_MARKDOWN_CHUNK) throw new Error("docs: one Markdown line exceeds the bounded renderer input");
    if (length + line.length + 1 > SITE_MARKDOWN_CHUNK) flush();
    lines.push(line);
    length += line.length + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;
  }
  flush();
  return chunks.join("\n");
}

function relatedLinks(record: DocRecord, docs: DocRecord[]): string {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const related = record.related.flatMap((id) => {
    const doc = byId.get(id);
    return doc ? [`<a href="${docRoute(doc.id)}">${escapeHtml(displayDocTitle(doc))}</a>`] : [];
  });
  return related.length ? `<div><h2>Related pages</h2>${related.join("")}</div>` : "";
}

function searchControls(): string {
  return `<form class="docs-search" role="search" data-doc-search-form><label for="docs-query">Search docs</label><input id="docs-query" name="q" type="search" autocomplete="off" placeholder="Try ‘import’ or ‘format’"><p class="docs-search-status" data-doc-search-status role="status">Search loads when JavaScript is available.</p><ol data-doc-search-results hidden></ol><noscript><p>Search needs JavaScript. The page list and articles work without it.</p></noscript></form>`;
}

function indexBody(index: DocsIndex): string {
  const userStart = index.docs.find((doc) => doc.id === "guide/getting-started");
  const devStart = index.docs.find((doc) => doc.id === "reference/README");
  const cards = [userStart, devStart].flatMap((doc) => doc ? [`<a class="docs-start-card" href="${docRoute(doc.id)}"><span>${doc.audience === "user" ? "For using Bunzai" : "For building with Bunzai"}</span><h2>${escapeHtml(displayDocTitle(doc))}</h2><p>${escapeHtml(doc.summary)}</p></a>`] : []);
  return `<div class="docs-layout docs-index-layout" data-doc-search data-index-href="../docs/docs-index.json" data-doc-root="${ROOT}docs/">
<aside class="docs-sidebar"><a class="docs-index-link" href="${ROOT}docs/index.html" aria-current="page">All documentation</a>${searchControls()}<nav aria-label="Documentation pages">${navGroups(index, "")}</nav></aside>
<main class="docs-article"><p class="docs-kicker">Bunzai documentation</p><h1>One guide, one reference, all in one place.</h1><p class="docs-lede">Browse the same documentation that ships inside Bunzai. Start with the user guide, or look up a format, concept, setting, or extension contract.</p><div class="docs-start-grid">${cards.join("")}</div><section class="docs-overview"><h2>Browse the complete library</h2><p>${index.count} pages from the bundled documentation index. The left navigation is grouped for readers and developers; search narrows the same corpus.</p></section></main>
<aside class="docs-toc" aria-label="Documentation overview"><h2>Start here</h2><ol><li><a href="${userStart ? docRoute(userStart.id) : ROOT + "docs/index.html"}">Install and make a first piece</a></li><li><a href="${devStart ? docRoute(devStart.id) : ROOT + "docs/index.html"}">Architecture and source map</a></li><li><a href="${ROOT}download.html">Current installation options</a></li></ol></aside>
</div>`;
}

export function buildDocumentationSite(root: string, index: DocsIndex, figures: DocFigure[], read: (record: DocRecord) => string): DocumentationSite {
  return safeWindow(() => {
    const pages = index.docs.map((record) => {
      if (!resolveDocPage(root, index, record.id) || record.id.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error(`docs: invalid source page mapping for ${record.id}`);
      }
      const path = `docs/${record.id.split("/").map(encodeURIComponent).join("/")}.html`;
      return { path, id: record.id, title: displayDocTitle(record), summary: record.summary, body: articleBody(root, index, figures, record, read(record)) };
    });
    pages.unshift({ path: "docs/index.html", id: "", title: "Documentation", summary: "Bunzai user guides and developer reference.", body: indexBody(index) });
    return { pages, searchIndex: JSON.stringify(index).replaceAll("<", "\\u003c") };
  });
}
