/**
 * The website's pages as HTML strings: the shared frame (fonts, nav, footer, logo) and every page.
 * Pure; scripts/build-site.ts writes the result into dist/pages. Copy must match the shipped app.
 * Links are relative (`up` climbs out of a subfolder) because Pages serves the site under /Bunzai/.
 */
import type { GuideRedirect } from "./guides";
import { infoBody } from "./info";
import { auditoriumBody, curtainIntroMarkup } from './auditorium';
import { CAST, tourBody } from "./tour";
import { icSvg } from '../ui/_shared/ic-svg';
import { docRoute, type DocumentationPage } from "./documentation";
import { escapeHtml } from "../ui/_shared/render-policy";

export interface Page {
  readonly path: string;
  readonly html: string;
}

const REPO = "https://github.com/Vaudeville-Studios/Bunzai";
const SITE = 'https://vaudeville-studios.github.io/Bunzai/';
type Section = "home" | "info" | "tour" | "docs" | "news" | "download" | "none";

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
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
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
${section === "docs" ? `<link rel="stylesheet" href="${up}docs.css">` : ""}
</head>
<body data-page="${section}">
${section === "home" ? curtainIntroMarkup() : ""}


<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap"><nav class="nav" aria-label="Main">
<a class="brand" href="${up}index.html"><span class="brand-symbol"><img src="${up}media/bunzai-mark.png" width="64" height="64" alt=""></span>Bunzai<span class="brand-stop">.</span></a>
${section === 'home' ? `<a class="link repo-star" href="${REPO}" target="_blank" rel="noopener" aria-label="Star Bunzai on GitHub" title="Open GitHub to star Bunzai"><span aria-hidden="true">${icSvg('lucide:star')}</span>Star repo</a><a class="link" href="${REPO}" target="_blank" rel="noopener">Open repo</a><a class="link" href="${up}docs/index.html">Docs</a>` : `${link('info', `${up}info.html`, 'Info')}${link("tour", `${up}tour/scenes.html`, "Tour")}${link("docs", `${up}docs/index.html`, "Docs")}${link("news", `${up}news.html`, "What's new")}<a class="link" href="${up}studio/">Try it</a>`}
<a class="btn" href="${up}download.html">Download</a>
</nav></div></header>
<main id="main">
${body}
</main>
<div class="wrap"><footer><span>bunzai &middot; free and open source &middot; a Coneja-Chibi production</span>
<span class="links"><a href="${up}docs/index.html">Docs</a><a href="${up}studio/">Browser Studio</a><a href="${REPO}">GitHub</a><a href="${REPO}/issues">Report a problem</a></span></footer></div>
<script type="module" src="${up}site.js"></script>
</body>
</html>
`;
}

const ticket = (up: string): string => `<div class="ticket">
<div class="adm">ADMIT ONE &middot; ANY NIGHT</div>
<h3>Bunzai</h3>
<p>Free and open source. No account needed.</p>
<div class="tear"></div>
<p class="ticket-status">No public release is available yet. The source checkout is ready to use.</p>
<a class="btn" href="${up}docs/guide/installation.html">Read the installation guide</a>
</div>`;

function home(): Page {
  return { path: "index.html", html: frame({ title: "Bunzai | All the worlds: your stage", description: "Make characters, build their worlds, and play stories with an AI provider you choose. Free and open source.", up: "", section: "home", body: auditoriumBody() }) };
}

function info(): Page {
  return { path: 'info.html', html: frame({ title: 'About Bunzai | Your stories. Your studio.', description: 'Characters, worlds, scenes and the tools behind them. Get to know Bunzai.', up: '', section: 'info', body: infoBody(ticket('')) }) };
}

function download(): Page {
  const body = `<div class="wrap page">
<div class="act"><b>Act IV</b> &middot; your ticket</div>
<h1>Run Bunzai from source.</h1>
<p class="lede">There are no published release assets at the moment. The source checkout is the available installation path; the guide explains the exact steps and what to expect on each platform.</p>
${ticket("")}
<section class="s tight"><h2>Source install</h2>
<p class="lede">Install <a class="more" href="https://bun.sh">Bun</a> at the <a href="${REPO}/blob/Mainstage/.bun-version">version pinned by the project</a>, then clone Bunzai with its rp-core submodule:</p>
<pre class="source"><code>git clone --recurse-submodules ${REPO}.git
cd Bunzai</code></pre>
<pre class="source"><code>bun install --frozen-lockfile
bun run dev</code></pre>
<p>The server prints the loopback address to open in your browser. If port 8321 is busy, Bunzai selects another free port and prints that address.</p>
<p><a class="more" href="docs/guide/installation.html">Full illustrated installation guide</a></p></section>
<section class="s tight"><h2>What each build is for</h2><p>The release workflow defines a Windows desktop executable, cross-platform CLI builds, and optional remote helpers. Those files are not downloadable until a GitHub release is published. The <a class="more" href="${REPO}/releases">release page</a> is the source of truth for current files; do not use an old or guessed download link.</p><p>The <a href="studio/">Browser Studio</a> is a temporary browser session for trying import, editing, and export. Its data does not persist after reload, and playing scenes requires the installed application.</p></section>
</div>`;
  return { path: "download.html", html: frame({ title: "Install Bunzai", description: "Install Bunzai from source and choose the right platform build when releases are available.", up: "", section: "download", body }) };
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

function guidePages(guides: readonly GuideRedirect[]): Page[] {
  return guides.filter((guide) => guide.slug !== "index").map((guide) => {
    const target = docRoute(guide.id);
    const body = `<div class="wrap page"><div class="act"><b>Documentation moved</b></div><h1>${escapeHtml(guide.title)}</h1><p class="lede">This guide now lives in the complete documentation library.</p><p><a class="btn" href="${target}">Open ${escapeHtml(guide.title)}</a></p><script>location.replace(${JSON.stringify(target)}+location.hash)</script></div>`;
    return { path: `guides/${guide.slug}.html`, html: frame({ title: `${guide.title}: Bunzai`, description: guide.summary, up: "../", section: "docs", body }) };
  });
}

function guideIndexRedirect(): Page {
  const target = docRoute("guide/README");
  const body = `<div class="wrap page"><div class="act"><b>Documentation moved</b></div><h1>All guides are in Docs.</h1><p class="lede">The complete user and developer documentation now has one searchable source.</p><p><a class="btn" href="${target}">Open user documentation</a> <a class="btn ghost" href="/Bunzai/docs/index.html">Browse all Docs</a></p><script>location.replace(${JSON.stringify(target)}+location.hash)</script></div>`;
  return { path: "guides/index.html", html: frame({ title: "Guides moved: Bunzai", description: "Open the complete Bunzai Docs library.", up: "../", section: "docs", body }) };
}

/** Every page of the site, given the rendered guides. */
export function sitePages(guides: readonly GuideRedirect[], documentation: readonly DocumentationPage[] = []): Page[] {
  const tour = CAST.map((m) => ({
    path: `tour/${m.id}.html`,
    html: frame({ title: `${m.name}: Bunzai`, description: m.card, up: "../", section: "tour", body: tourBody(m) }),
  }));
  const docs = documentation.map((doc) => {
    const depth = doc.id ? doc.id.split("/").length : 1;
    const up = "../".repeat(depth);
    return { path: doc.path, html: frame({ title: `${doc.title}: Bunzai`, description: doc.summary, up, section: "docs", body: doc.body }) };
  });
  const aliases = guidePages(guides);
  return [home(), info(), download(), news(), notFound(), ...tour, ...docs, guideIndexRedirect(), ...aliases].map(page => {
    const canonical = new URL(page.path === 'index.html' ? '' : page.path, SITE).href;
    return { ...page, html: page.html.replace('</head>', `<link rel="canonical" href="${canonical}">\n<meta property="og:url" content="${canonical}">\n</head>`) };
  });
}
