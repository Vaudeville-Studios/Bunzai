/** Public website regression: current branding across nested routes and truthful, usable homepage examples. */
import { expect, test } from 'bun:test';
import { sitePages } from './pages';

test('every website page uses the current mark with project-relative asset paths', () => {
  for (const page of sitePages([])) {
    const prefix = page.path === '404.html' ? '/Bunzai/' : page.path.includes('/') ? '../' : '';
    expect(page.html).toContain(`src="${prefix}media/bunzai-mark.png"`);
    expect(page.html).toContain(`href="${prefix}site.css"`);
    expect(page.html).not.toContain('href="#bun"');
    expect(page.html).not.toContain('id="bun"');
  }
});

test('the auditorium links to a separate info page with product details and existing destinations', () => {
  const pages = sitePages([]);
  const home = pages.find(page => page.path === 'index.html')!.html;
  const info = pages.find(page => page.path === 'info.html')!.html;
  expect(home).toContain('href="info.html"');
  expect(home).toContain('src="media/cinema-auditorium.png"');
  expect(home).toContain('data-screening');
  expect(home).toContain('data-curtain-intro hidden');
  expect(home).toContain('data-screen-preroll hidden');
  expect(home).toContain('Bunzai | All the worlds: your stage');
  expect(home).toContain('All the worlds: your stage');
  expect(home).toContain('data-screen-step="1"');
  expect(home).not.toContain('data-scene-example');
  for (const destination of ['download.html', 'studio/', 'guides/getting-started.html', 'guides/importing.html', 'news.html']) {
    expect(info).toContain(`href="${destination}"`);
  }
  expect(info).toContain('src="media/shot-scenes.png"');
  expect(info).toContain('Playing scenes needs the installed app.');
  expect(home).not.toContain('ren-cutout');
  expect(home).not.toContain('journey.html');
  expect(home).toContain('aria-label="Star Bunzai on GitHub"');
  expect(home).toContain('>Open repo</a>');
  expect(home).toContain('href="docs/index.html">Docs</a>');
  expect(home).not.toContain('>Info</a>');
  expect(home).not.toContain('>Pictures</a>');
  expect(home).toContain('media/shot-scene-chat.png');
  expect(home).toContain('media/shot-scenes.png');
  expect(home).toContain('media/shot-preset.png');
  expect(home).toContain('media/shot-theme-paper.png');
  expect(home).not.toContain('media/shot-theme-rolecall.png');
  expect(home).not.toContain('media/shot-theme-theater.png');
  expect(home).toContain('property="og:image" content="https://vaudeville-studios.github.io/Bunzai/media/bunzai-preview.png"');
  expect(home).toContain('property="og:url" content="https://vaudeville-studios.github.io/Bunzai/"');
});

test("installation presents three OS choices without guessing unpublished download URLs", () => {
  const pages = sitePages([]);
  const download = pages.find((page) => page.path === "download.html")!.html;
  for (const os of ["windows", "linux", "mac"]) expect(download).toContain(`data-os="${os}"`);
  expect(download).toContain("data-app-download=\"mac\"");
  expect(download).toContain("data-app-download=\"windows\"");
  expect(download).toContain("data-app-download=\"linux\"");
  expect(download).not.toContain("There are no published release assets at the moment.");
  expect(download).toContain("git clone --recurse-submodules");
  expect(download).not.toContain("releases/latest/download");
});
