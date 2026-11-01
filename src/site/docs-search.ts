/** Progressive search for the static documentation nav; article links remain usable without it. */
import { parseDocsIndex } from "../docs/corpus";
import { searchDocs } from "../ui/apps/docs/docs-core";

const RESULT_LIMIT = 20;

function route(root: string, id: string): string {
  return `${root}${id.split("/").map(encodeURIComponent).join("/")}.html`;
}

export function runDocsSearch(doc: Document): void {
  const layout = doc.querySelector<HTMLElement>("[data-doc-search]");
  const input = layout?.querySelector<HTMLInputElement>("[data-doc-search-form] input[type=search]");
  const status = layout?.querySelector<HTMLElement>("[data-doc-search-status]");
  const results = layout?.querySelector<HTMLOListElement>("[data-doc-search-results]");
  const indexHref = layout?.dataset.indexHref;
  const root = layout?.dataset.docRoot;
  if (!layout || !input || !status || !results || !indexHref || !root) return;

  const indexUrl = new URL(indexHref, doc.baseURI);
  void fetch(indexUrl).then((response) => {
    if (!response.ok) throw new Error("The search index is unavailable.");
    return response.json() as Promise<unknown>;
  }).then((raw) => {
    const index = parseDocsIndex(raw);
    if (!index) throw new Error("The documentation index is invalid.");
    status.textContent = "Search the page titles, sections, and summaries.";
    input.addEventListener("input", () => {
      const query = input.value.trim();
      results.replaceChildren();
      if (!query) { results.hidden = true; status.textContent = "Search the page titles, sections, and summaries."; return; }
      const matches = searchDocs(index.docs, query);
      for (const record of matches.slice(0, RESULT_LIMIT)) {
        const item = doc.createElement("li");
        const link = doc.createElement("a");
        link.href = route(root, record.id);
        const title = doc.createElement("strong");
        title.textContent = record.title;
        const summary = doc.createElement("span");
        summary.textContent = record.summary;
        link.append(title, summary);
        item.append(link);
        results.append(item);
      }
      results.hidden = matches.length === 0;
      status.textContent = matches.length === 0
        ? `No pages match “${query}”.`
        : matches.length > RESULT_LIMIT
          ? `Showing ${RESULT_LIMIT} of ${matches.length} pages. Refine your search to see more.`
          : `${matches.length} page${matches.length === 1 ? "" : "s"} found.`;
    });
  }).catch(() => { status.textContent = "Search is unavailable; use the page list below."; });
}
