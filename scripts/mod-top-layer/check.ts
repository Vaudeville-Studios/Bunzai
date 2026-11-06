/**
 * The browser half of the top-layer proof, run under Node (Playwright cannot attach to Chrome from Bun on Windows).
 * Args: bundle path (the bundled theme-mod pipeline), tokens.css path, work folder, port. Prints one JSON object.
 * The page is a harness: the real tokens.css and the real apply pipeline, a modal protected prompt, an inline protected
 * surface, and a hostile mod on top. It measures; protected-browser.test.ts asserts.
 */
import { readFileSync } from "node:fs";
import { launch } from "../theme-measure/driver.ts";

const [bundlePath, tokensPath, work, port] = process.argv.slice(2) as [string, string, string, string];
const bundle = readFileSync(bundlePath, "utf8");
const tokens = readFileSync(tokensPath, "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}</style>
<style>body{margin:0;font-family:sans-serif}.veil{display:none}.dot{display:none}.rem15{font-size:1.5rem;margin:0}</style></head>
<body>${body}<script>${bundle}</script></body></html>`;

const THEME = (styles: string) => ({ themeId: "t", packageId: "t", digest: "d".repeat(64), grantedScopes: [], appearance: null, assets: [], fonts: [], styles, slots: {} });

const MODAL = `<p id="plain" class="rem15">plain text</p><p id="dummy">filler</p>
<dialog id="prompt" class="host-protected"><p id="inner" class="rem15">protected text</p><button id="yes">Yes</button></dialog>
<div class="veil" id="veil"></div>`;
const INLINE = `<p id="plain" class="rem15">plain text</p>
<section id="mgr" class="host-protected" style="position:relative;width:600px;height:300px;margin:100px"><p id="inner" class="rem15">manager</p></section>
<div class="dot" id="dot"></div>`;

interface Win { Mod: { paintMod(t: unknown): void; removeMod(): void; checkProtectedNow(full?: boolean): boolean; setModHandlers(h: unknown): void }; broken: unknown[]; scans: number }

async function open(page: import("playwright-core").Page, body: string, styles: string, many = 0): Promise<void> {
  await page.setContent(PAGE(body));
  await page.evaluate(([styles, many, theme]) => {
    const w = window as unknown as Win;
    w.broken = [];
    w.scans = 0;
    const d0 = document as unknown as { __qsa?: typeof document.querySelectorAll };
    const qsa = (d0.__qsa ??= document.querySelectorAll.bind(document));
    document.querySelectorAll = ((s: string) => { if (s === "*") w.scans++; return qsa(s); }) as typeof document.querySelectorAll;
    for (let i = 0; i < (many as number); i++) { const d = document.createElement("div"); d.innerHTML = "<span><b></b></span>"; document.body.append(d); }
    (document.getElementById("prompt") as HTMLDialogElement | null)?.showModal();
    w.Mod.setModHandlers({ broken: (i: unknown) => w.broken.push(i), healthy: () => {} });
    w.Mod.paintMod({ ...(theme as object), styles });
  }, [styles, many, THEME(styles)] as const);
  await sleep(700);
}
const size = (page: import("playwright-core").Page, id: string) => page.evaluate((id) => parseFloat(getComputedStyle(document.getElementById(id)!).fontSize), id);
const rectOf = (page: import("playwright-core").Page, id: string) => page.evaluate((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return { w: r.width, h: r.height }; }, id);
const state = (page: import("playwright-core").Page) => page.evaluate(() => ({ modOn: !!document.getElementById("bk-mod-style"), broken: ((window as unknown as Win).broken as { reasons: string[] }[]).flatMap((b) => b.reasons) }));

const out: Record<string, unknown> = {};
const browser = await launch(work, Number(port));
try {
  const page = browser.page;
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });

  // 1. mods that scale html or smear inherited text: protected text keeps its rendered size, plain text does not
  const probeText = () => page.evaluate(() => {
    const r = (id: string) => { const b = document.getElementById(id)!.getBoundingClientRect(); return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 }; };
    const inner = document.getElementById("inner")!;
    const cs = getComputedStyle(inner);
    const plain = getComputedStyle(document.getElementById("plain")!);
    return { plain: r("plain"), prot: r("inner"), fill: cs.webkitTextFillColor, spacing: cs.letterSpacing, shadow: cs.textShadow, plainFill: plain.webkitTextFillColor, plainSpacing: plain.letterSpacing };
  });
  await open(page, MODAL, ".veil{display:none}");
  const base = await probeText();
  const font: Record<string, unknown> = { base };
  for (const [name, css] of [["html font-size 400%", "html{font-size:400%}"], ["html zoom 4", "html{zoom:4}"], ["body zoom 3", "body{zoom:3}"], ["html font-size 1px", "html{font-size:1px}"],
    ["text smear", "body{-webkit-text-fill-color:transparent;letter-spacing:2em;text-shadow:0 0 9px red;word-spacing:3em}"]] as const) {
    await open(page, MODAL, css);
    font[name] = { ...(await probeText()), ...(await state(page)) };
    if (name === "html font-size 400%") await page.screenshot({ path: `${work}/font.png` });
  }
  out.font = font;

  // 2. a full-screen fixed overlay with the largest z-index: the top-layer prompt stays on top and the mod stays
  await open(page, MODAL, ".veil{display:block;position:fixed;inset:0;z-index:2147483647;background:#c00}");
  out.cover = await page.evaluate(() => {
    const p = document.getElementById("prompt")!.getBoundingClientRect();
    const at = (x: number, y: number) => document.elementFromPoint(x, y)?.id ?? document.elementFromPoint(x, y)?.tagName;
    const top = document.getElementById("prompt")!.matches(":modal");
    const inside = at(p.left + p.width / 2, p.top + p.height / 2);
    (document.getElementById("prompt") as HTMLDialogElement).close();
    const control = at(p.left + p.width / 2, p.top + p.height / 2); // with the prompt closed the overlay is what a click would hit
    (document.getElementById("prompt") as HTMLDialogElement).showModal();
    return { top, inside, control };
  });
  Object.assign(out.cover as object, await state(page));
  await page.screenshot({ path: `${work}/cover.png` });

  // 3. a small overlay over the inline manager trips the watchdog
  await open(page, INLINE, ".dot{display:block;position:absolute;left:300px;top:150px;width:90px;height:90px;background:#c00}");
  out.small = await state(page);

  // 4. cost and cadence on a large page (the inline manager needs the full scan), mod benign
  await open(page, INLINE, "body{background:#eee}", 2500);
  const cost = await page.evaluate(() => {
    const w = window as unknown as Win;
    const time = (full: boolean) => { const t = performance.now(); for (let i = 0; i < 5; i++) w.Mod.checkProtectedNow(full); return (performance.now() - t) / 5; };
    return { elements: document.querySelectorAll("*").length, fullMs: time(true), cheapMs: time(false) };
  });
  const scansBefore = await page.evaluate(() => (window as unknown as Win).scans);
  await sleep(6500);
  out.cost = { ...cost, quietScansIn6500ms: (await page.evaluate(() => (window as unknown as Win).scans)) - scansBefore, modOn: (await state(page)).modOn };

  // 5. a host-hidden control causes a baseline sample; that sample must not rewind unrelated themed animation.
  await open(page, INLINE + '<div id="pulse" class="pulse">pulse</div><div id="light" class="light">light</div>',
    '@keyframes mod-pulse{from{transform:translateX(0)}to{transform:translateX(100px)}}.pulse{animation:mod-pulse 10s linear infinite}.light{background:#ff0000}.light.dim{background:#00ff00}');
  out.continuity = await page.evaluate(async () => {
    // The mod's own mount scan runs on the next frame, which a slow machine puts late: it lands before the count below starts.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // This harness enables animation explicitly; the screenshot runner's freeze is irrelevant here.
    for (const style of document.querySelectorAll("style")) if (style.textContent?.includes("animation:none!important")) style.remove();
    const host = document.createElement("style");
    host.textContent = ".light{transition:background-color 10s linear;background:#0000ff}";
    document.head.prepend(host);
    const mgr = document.getElementById("mgr")!;
    mgr.style.display = "none";
    const pulse = document.getElementById("pulse")!, light = document.getElementById("light")!;
    const animation = pulse.getAnimations().find((a) => "animationName" in a && a.animationName === "mod-pulse")!;
    animation.currentTime = 4000;
    getComputedStyle(light).backgroundColor;
    light.classList.add("dim");
    getComputedStyle(light).backgroundColor;
    const transition = light.getAnimations().find((a) => "transitionProperty" in a && a.transitionProperty === "background-color")!;
    transition.currentTime = 4000;
    const transitionBefore = Number(transition.currentTime);
    const color = getComputedStyle(light).backgroundColor;
    const before = Number(animation.currentTime);
    const w = window as unknown as Win;
    w.Mod.checkProtectedNow(false);
    const after = Number(pulse.getAnimations().find((a) => "animationName" in a && a.animationName === "mod-pulse")!.currentTime);
    const colorAfter = getComputedStyle(light).backgroundColor;
    const transitionAfter = Number(light.getAnimations().find((a) => "transitionProperty" in a && a.transitionProperty === "background-color")?.currentTime ?? -1);
    const scans = w.scans;
    await new Promise((resolve) => setTimeout(resolve, 900));
    const extraScans = w.scans - scans;
    return { before, after, color, colorAfter, transitionBefore, transitionAfter, extraScans, ...{ modOn: !!document.getElementById("bk-mod-style"), broken: w.broken } };
  });

} finally { await browser.close(); }
console.log("RESULT" + JSON.stringify(out));
