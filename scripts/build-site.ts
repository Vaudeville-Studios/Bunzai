/** Build the public website into a folder: pages, the rendered user guides, media, fonts, style, and script. */
import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { guideSlug, type GuideRedirect } from "../src/site/guides";
import { sitePages } from "../src/site/pages";
import { parseDocsIndex, resolveDocPage } from "../src/docs/corpus";
import type { DocFigure } from "../src/docs/types";
import { buildDocumentationSite } from "../src/site/documentation";
import { bundleBrowser } from "./ui-bundle";
import { ICON_FILES } from '../src/ui/assets';

export async function buildSite(root: string, output: string): Promise<number> {
  const write = async (relative: string, body: string): Promise<void> => {
    const path = join(output, ...relative.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, body);
  };
  const docsIndex = parseDocsIndex(await Bun.file(join(root, "docs/generated/docs-index.json")).json());
  if (!docsIndex) throw new Error("site build: generated DocsIndex is invalid");
  const rawFigures = await Bun.file(join(root, "docs/generated/figures.json")).json();
  if (!Array.isArray(rawFigures) || !rawFigures.every((item) => item && typeof item === "object" && typeof item.svg === "string")) {
    throw new Error("site build: generated figure inventory is invalid");
  }
  const figures = rawFigures as DocFigure[];
  const markdown = new Map<string, string>();
  const guides: GuideRedirect[] = [];
  for (const doc of docsIndex.docs) {
    const source = resolveDocPage(root, docsIndex, doc.id);
    if (!source) throw new Error(`site build: DocsIndex page is not contained: ${doc.id}`);
    markdown.set(doc.id, await Bun.file(source).text());
    const slug = guideSlug(doc.path);
    if (slug) guides.push({ slug, id: doc.id, title: doc.title, summary: doc.summary });
  }
  guides.sort((a, b) => a.slug.localeCompare(b.slug));
  const documentation = buildDocumentationSite(root, docsIndex, figures, (doc) => markdown.get(doc.id) ?? "");
  const pages = sitePages(guides, documentation.pages);
  for (const page of pages) await write(page.path, page.html);
  await write("docs/docs-index.json", documentation.searchIndex);
  for (const sheet of ['site.css', 'home.css', 'info.css', 'docs.css']) await write(sheet, await Bun.file(join(root, 'src/site', sheet)).text());
  await write("site.js", await bundleBrowser(join(root, "src", "site", "client.ts"), []));
  await cp(join(root, "docs", "media"), join(output, "media"), { recursive: true });
  await cp(join(root, "docs", "media"), join(output, "docs", "media"), { recursive: true });
  await cp(join(root, "docs", "generated", "figures"), join(output, "docs", "generated", "figures"), { recursive: true });
  await mkdir(join(output, 'theme'), { recursive: true });
  await copyFile(join(root, 'src/ui/theme/tokens.css'), join(output, 'theme/tokens.css'));
  await cp(join(root, 'src/ui/theme/fonts'), join(output, 'theme/fonts'), { recursive: true });
  await copyFile(join(root, 'build', ICON_FILES['icon-256.png'][0]), join(output, 'media/bunzai-mark.png'));
  await copyFile(join(root, 'build', ICON_FILES['favicon.ico'][0]), join(output, 'favicon.ico'));
  return pages.length;
}
