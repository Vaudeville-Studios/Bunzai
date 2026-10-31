/**
 * The website's pages as HTML strings: the shared frame (fonts, nav, footer, logo) and every page.
 * Pure; scripts/build-site.ts writes the result into dist/pages. Copy must match the shipped app.
 * Links are relative (`up` climbs out of a subfolder) because Pages serves the site under /Bunzai/.
 */
import type { Guide } from "./guides";
import { infoBody } from "./info";
import { auditoriumBody, curtainIntroMarkup } from './auditorium';
import { CAST, tourBody } from "./tour";
import { icSvg } from '../ui/_shared/ic-svg';

export interface Page {
  readonly path: string;
  readonly html: string;
}

const REPO = "https://github.com/Vaudeville-Studios/Bunzai";
const SITE = 'https://vaudeville-studios.github.io/Bunzai/';
const LATEST = `${REPO}/releases/latest/download/`;

type Section = "home" | "info" | "tour" | "guides" | "news" | "download" | "none";

interface Frame {
  readonly title: string;
  readonly description: string;
  readonly up: string;
  readonly section: Section;
  readonly body: string;
}

function frame({ title, description, up, section, body }: Frame): string {
  const link = (s: Section, href: string, label: string): string =>
    `<a class="link" href="${href}"${s === section ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bunzai">
<meta property="og:image" content="${SITE}media/bunzai-preview.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Bunzai. All the worlds: your stage, on a crimson cinema screen.">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0a0b">
<link rel="icon" href="${up}favicon.ico">
<link rel="stylesheet" href="${up}site.css">
${section === "home" ? `<link rel="stylesheet" href="${up}home.css">` : ""}
${section === 'info' ? `<link rel="stylesheet" href="${up}info.css">` : ''}
</head>
<body data-page="${section}">
${section === "home" ? curtainIntroMarkup() : ""}


<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap"><nav class="nav" aria-label="Main">
<a class="brand" href="${up}index.html"><span class="brand-symbol"><img src="${up}media/bunzai-mark.png" width="64" height="64" alt=""></span>Bunzai<span class="brand-stop">.</span></a>
${section === 'home' ? `<a class="link repo-star" href="${REPO}" target="_blank" rel="noopener" aria-label="Star Bunzai on GitHub" title="Open GitHub to star Bunzai"><span aria-hidden="true">${icSvg('lucide:star')}</span>Star repo</a><a class="link" href="${REPO}" target="_blank" rel="noopener">Open repo</a>` : `${link('info', `${up}info.html`, 'Info')}${link("tour", `${up}tour/scenes.html`, "Tour")}${link("guides", `${up}guides/index.html`, "Guides")}${link("news", `${up}news.html`, "What's new")}<a class="link" href="${up}studio/">Try it</a>`}
<a class="btn" href="${up}download.html">Download</a>
</nav></div></header>
<main id="main">
${body}
</main>
<div class="wrap"><footer><span>bunzai &middot; free and open source &middot; a Coneja-Chibi production</span>
<span class="links"><a href="${up}guides/index.html">Guides</a><a href="${up}studio/">Browser Studio</a><a href="${REPO}">GitHub</a><a href="${REPO}/issues">Report a problem</a></span></footer></div>
<script type="module" src="${up}site.js"></script>
</body>
</html>
`;
}

const ticket = (up: string): string => `<div class="ticket">
<div class="adm">ADMIT ONE &middot; ANY NIGHT</div>
<h3>Bunzai</h3>
<p>Free, open source, and yours to keep. No account needed.</p>
<div class="tear"></div>
<div class="os"><a href="${LATEST}Bunzai.exe">Windows</a><a href="${up}download.html#mac">Mac</a><a href="${up}download.html#linux">Linux</a></div>
<small><span data-version>latest</span> &middot; Mac and Linux run from the terminal</small>
</div>`;

function home(): Page {
  return { path: "index.html", html: frame({ title: "Bunzai | All the worlds: your stage", description: "Make characters, build their worlds, and play stories with an AI provider you choose. Free and open source.", up: "", section: "home", body: auditoriumBody() }) };
}

function info(): Page {
  return { path: 'info.html', html: frame({ title: 'About Bunzai | Your stories. Your studio.', description: 'Characters, worlds, scenes and the tools behind them. Get to know Bunzai.', up: '', section: 'info', body: infoBody(ticket('')) }) };
}

function download(): Page {
  const os = (id: string, name: string, steps: string, extra = ""): string =>
    `<section class="os-block" id="${id}" data-os="${id}"><h2>${name}</h2><ol class="steps">${steps}</ol>${extra}</section>`;
  const body = `<div class="wrap page">
<div class="act"><b>Act IV</b> &middot; your ticket</div>
<h1>Get Bunzai.</h1>
<p class="lede">Free and open source. Every download comes from the latest release on GitHub, <span data-version>latest</span>.</p>
<div class="pair" style="margin-top:36px">
<div>
${os("windows", "Windows", `<li>Download <a class="more" href="${LATEST}Bunzai.exe">Bunzai.exe</a>.</li><li>Before opening it, check the release page for verification details. If it publishes a checksum for this exact release file, compare the downloaded file with it. If no checksum is published, you can build from source using the steps below.</li><li>This build is unsigned, so Windows may show a reputation warning. The warning does not establish whether a file is safe. Continue only if you trust the source and have verified the download; otherwise cancel.</li>`, `<p class="note">App starts but no window? Install Microsoft's <a class="more" href="https://developer.microsoft.com/microsoft-edge/webview2/">WebView2 runtime</a> and open it again. Windows 11 already has it.</p>`)}
${os("mac", "Mac", `<li>Download the one for your Mac: <a class="more" href="${LATEST}bunzai-cli-darwin-arm64">Apple Silicon</a> or <a class="more" href="${LATEST}bunzai-cli-darwin-x64">Intel</a>.</li><li>In Terminal, make it runnable: <code>chmod +x bunzai-cli-darwin-arm64</code></li><li>Start it: <code>./bunzai-cli-darwin-arm64 ui</code></li><li>Open the address it prints in your browser.</li>`)}
${os("linux", "Linux", `<li>Download the one for your machine: <a class="more" href="${LATEST}bunzai-cli-linux-x64">Intel or AMD</a> or <a class="more" href="${LATEST}bunzai-cli-linux-arm64">ARM, like a Raspberry Pi</a>.</li><li>Make it runnable: <code>chmod +x bunzai-cli-linux-x64</code></li><li>Start it: <code>./bunzai-cli-linux-x64 ui</code></li><li>Open the address it prints in your browser.</li>`)}
</div>
<div>${ticket("")}
<p class="note" style="--c:var(--mint)">Your pieces are stored in <code>Documents/Bunzai Studio</code> on your computer and encrypted at rest. Key protection depends on your setup; some fallback configurations store a key file beside the library. AI requests send selected content to your chosen provider, and connected services receive the data needed for their features. Opening Bunzai again while it is running just opens another window onto the same studio.</p>
<p class="note" style="--c:var(--lilac)"><b>Kit</b>, the optional terminal companion, is a separate download on the <a class="more" href="${REPO}/releases/latest">release page</a>. <a class="more" href="tour/kit.html">What is Kit?</a></p>
<p class="note" style="--c:var(--sky)">Want to check your download? Check the release page for a checksum published for that exact file and release. If no checksum is listed, build Bunzai from source using the instructions below.</p>
</div></div>
<section class="s tight" style="padding-top:56px"><h2>Or run it from source</h2>
<p class="lede">You need <a class="more" href="https://bun.sh">Bun</a> 1.3 or newer.</p>
<pre class="source"><code>git clone ${REPO}
cd Bunzai
bun install
bun run dev</code></pre></section>
</div>`;
  return { path: "download.html", html: frame({ title: "Download Bunzai", description: "Get Bunzai for Windows, Mac, or Linux. Free and open source.", up: "", section: "download", body }) };
}

function news(): Page {
  const body = `<div class="wrap page">
<div class="act"><b>Act III</b> &middot; what's new</div>
<h1>Fresh from rehearsal.</h1>
<p class="lede">Every release, newest first, straight from GitHub.</p>
<ul class="news" data-news="full"><li><div class="v"></div><div><p>Loading the releases.</p></div></li></ul>
<a class="more" href="${REPO}/releases">All releases on GitHub &rarr;</a>
</div>`;
  return { path: "news.html", html: frame({ title: "What's new in Bunzai", description: "Every Bunzai release, newest first.", up: "", section: "news", body }) };
}

function notFound(): Page {
  const body = `<div class="wrap page" style="min-height:50vh"><div class="act"><b>Intermission</b></div>
<h1>This page wandered off stage.</h1><p class="lede">It may have moved, or never existed.</p>
<div class="row" style="margin-top:28px"><a class="btn" href="/Bunzai/">Back to the start</a><a class="btn ghost" href="/Bunzai/studio/">Open the Studio</a></div></div>`;
  return { path: "404.html", html: frame({ title: "Not found: Bunzai", description: "This page wandered off stage.", up: "/Bunzai/", section: "none", body }) };
}

const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["Start here", ["getting-started", "importing", "library"]],
  ["Make things", ["editing", "lorebooks", "personas", "regex"]],
  ["Send things out", ["exporting", "converting"]],
  ["When you need help", ["faq", "troubleshooting", "security"]],
];

/** Guides grouped for the index and the sidebar; platform notes and anything unlisted go last. */
function grouped(guides: readonly Guide[]): [string, Guide[]][] {
  const bySlug = new Map(guides.map((g) => [g.slug, g]));
  const listed = new Set(GROUPS.flatMap(([, slugs]) => slugs));
  const groups: [string, Guide[]][] = GROUPS.map(([name, slugs]) => [name, slugs.flatMap((s) => bySlug.get(s) ?? [])]);
  groups.push(["Other apps", guides.filter((g) => g.slug.startsWith("platforms"))]);
  groups.push(["More", guides.filter((g) => !listed.has(g.slug) && !g.slug.startsWith("platforms") && g.slug !== "index")]);
  return groups.filter(([, list]) => list.length > 0);
}

function guidePages(guides: readonly Guide[]): Page[] {
  const groups = grouped(guides);
  const side = (current: string): string => `<ul class="side">${groups.map(([name, list]) =>
    `<li class="small">${name}</li>${list.map((g) => `<li><a href="${g.slug}.html"${g.slug === current ? ' aria-current="page"' : ""}>${g.title}</a></li>`).join("")}`).join("")}</ul>`;
  const index = `<div class="wrap page"><div class="act"><b>Act V</b> &middot; guides</div>
<h1>Guides, written for people.</h1><p class="lede">Short, plain how-tos for everything Bunzai does.</p>
${groups.map(([name, list]) => `<div class="act" style="margin-top:44px">${name}</div><div class="grid-links" style="margin-top:0">${list.map((g) => `<a href="${g.slug}.html"><div><h3>${g.title}</h3><p>${g.summary}</p></div><span>&rarr;</span></a>`).join("")}</div>`).join("")}
</div>`;
  const pages: Page[] = [{ path: "guides/index.html", html: frame({ title: "Guides: Bunzai", description: "Short, plain how-tos for everything Bunzai does.", up: "../", section: "guides", body: index }) }];
  for (const g of guides) {
    if (g.slug === "index") continue;
    const body = `<div class="wrap page"><a class="crumb" href="index.html">&larr; All guides</a><div class="guide-wrap">${side(g.slug)}<article class="doc">${g.html}</article></div></div>`;
    pages.push({ path: `guides/${g.slug}.html`, html: frame({ title: `${g.title}: Bunzai`, description: g.summary, up: "../", section: "guides", body }) });
  }
  return pages;
}

/** Every page of the site, given the rendered guides. */
export function sitePages(guides: readonly Guide[]): Page[] {
  const tour = CAST.map((m) => ({
    path: `tour/${m.id}.html`,
    html: frame({ title: `${m.name}: Bunzai`, description: m.card, up: "../", section: "tour", body: tourBody(m) }),
  }));
  return [home(), info(), download(), news(), notFound(), ...tour, ...guidePages(guides)].map(page => {
    const canonical = new URL(page.path === 'index.html' ? '' : page.path, SITE).href;
    return { ...page, html: page.html.replace('</head>', `<link rel="canonical" href="${canonical}">\n<meta property="og:url" content="${canonical}">\n</head>`) };
  });
}
