/** Build the public website into a folder: pages, the rendered user guides, media, fonts, style, and script. */
import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderGuide, type Guide } from "../src/site/guides";
import { sitePages } from "../src/site/pages";
import { bundleBrowser } from "./ui-bundle";
import { ICON_FILES } from '../src/ui/assets';

export async function buildSite(root: string, output: string): Promise<number> {
  const write = async (relative: string, body: string): Promise<void> => {
    const path = join(output, ...relative.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, body);
  };
  const guides: Guide[] = [];
  for await (const relative of new Bun.Glob("docs/guide/**/*.md").scan({ cwd: root })) {
    const path = relative.replaceAll("\\", "/");
    const guide = renderGuide(path, await Bun.file(join(root, path)).text());
    if (guide) guides.push(guide);
  }
  guides.sort((a, b) => a.slug.localeCompare(b.slug));
  const pages = sitePages(guides);
  for (const page of pages) await write(page.path, page.html);
  for (const sheet of ['site.css', 'home.css', 'info.css']) await write(sheet, await Bun.file(join(root, 'src/site', sheet)).text());
  await write("site.js", await bundleBrowser(join(root, "src", "site", "client.ts"), []));
  await cp(join(root, "docs", "media"), join(output, "media"), { recursive: true });
  await mkdir(join(output, 'theme'), { recursive: true });
  await copyFile(join(root, 'src/ui/theme/tokens.css'), join(output, 'theme/tokens.css'));
  await cp(join(root, 'src/ui/theme/fonts'), join(output, 'theme/fonts'), { recursive: true });
  await copyFile(join(root, 'build', ICON_FILES['icon-256.png'][0]), join(output, 'media/bunzai-mark.png'));
  await copyFile(join(root, 'build', ICON_FILES['favicon.ico'][0]), join(output, 'favicon.ico'));
  return pages.length;
}
