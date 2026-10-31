/** Verify the built curtain, symbol preroll and reduced-motion path in Chromium. */
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.PAGES_PREVIEW_URL ?? "http://127.0.0.1:8922/Bunzai/";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const output = "dist/landing-preview/evidence";
const manifest = JSON.parse(await readFile("plans/preroll-symbol-assets.json", "utf8")) as { index: number; slug: string }[];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pageErrors: string[] = [];
const gpuCapture = `(() => {
  const frames = [], phraseLog = [], impacts = [];
  Object.defineProperties(window, { __symbolFrames: { value: frames }, __phraseLog: { value: phraseLog }, __impactCount: { value: impacts } });
  const record = gl => {
    const canvas = gl.canvas;
    if (!canvas?.hasAttribute("data-preroll-symbol-stencil")) return;
    const impact = !!document.querySelector("[data-preroll-symbol-stage]")?.classList.contains("is-stencilled");
    const pixels = [];
    for (const [x,y] of [[.05,.05],[.5,.05],[.95,.05],[.05,.5],[.5,.5],[.95,.5],[.05,.95],[.5,.95],[.95,.95]]) {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width*x), Math.floor(canvas.height*y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      pixels.push(...pixel);
    }
    frames.push({ impact, pixels });
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) {
    for (const method of ["drawArrays", "drawElements"]) {
      const draw = C.prototype[method];
      C.prototype[method] = function (...args) { const result = draw.apply(this,args); record(this); return result; };
    }
  }
  addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector("[data-screen-preroll]");
    const stage = root?.querySelector("[data-preroll-symbol-stage]");
    const wordsCard = root?.querySelector("[data-preroll-card='words']");
    const word = root?.querySelector("[data-preroll-word]");
    const image = root?.querySelector("[data-preroll-symbol]");
    if (!root || !stage || !wordsCard || !word || !image) return;
    let lastWord = "", lastSrc = "", hadImpact = stage.classList.contains("is-stencilled");
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target === stage && record.attributeName === "class") {
          const after = stage.classList.contains("is-stencilled");
          if (!hadImpact && after) impacts.push(word.textContent?.trim() ?? "");
          hadImpact = after;
        }
      }
      const text = word.textContent?.trim() ?? "", src = image.getAttribute("src") ?? "";
      if (wordsCard.classList.contains("is-current") && text && src && (text !== lastWord || src !== lastSrc)) {
        phraseLog.push({ word: text, src });
        lastWord = text;
        lastSrc = src;
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "src"] });
  }, { once: true });
})()`;
const alphaStats = (pixels: number[] | undefined) => ({
  visible: pixels?.filter((value, index) => index % 4 === 3 && value > 16).length ?? 0,
  transparent: pixels?.filter((value, index) => index % 4 === 3 && value < 8).length ?? 0,
});

try {
  const audit = await browser.newPage();
  await audit.goto(base, { waitUntil: "domcontentloaded" });
  const assetAudit = await audit.evaluate(async (slugs: string[]) => {
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d", { willReadFrequently: true })!;
    canvas.width = canvas.height = 64;
    const results = [];
    for (const slug of slugs) {
      const image = new Image();
      image.src = `media/preroll-symbols/${slug}-v1.webp`;
      await image.decode();
      context.clearRect(0, 0, 64, 64);
      context.drawImage(image, 0, 0, 64, 64);
      const alpha = context.getImageData(0, 0, 64, 64).data.filter((_, index) => index % 4 === 3);
      const transparent = alpha.filter(value => value < 8).length;
      const visible = alpha.filter(value => value > 16).length;
      results.push({ slug, transparent, visible });
    }
    return results;
  }, manifest.map(row => row.slug));
  if (assetAudit.length !== 31 || assetAudit.some(asset => !asset.transparent || !asset.visible)) throw new Error(`A symbol cutout was opaque or empty: ${JSON.stringify(assetAudit.filter(asset => !asset.transparent || !asset.visible))}`);
  await audit.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("pageerror", error => pageErrors.push(error.message));
  await desktop.route("https://api.github.com/**", route => route.abort());
  let symbolRequests = 0;
  const symbolResponses: { url: string; status: number }[] = [];
  desktop.on("request", request => { if (request.url().includes("/media/preroll-symbols/")) symbolRequests++; });
  desktop.on("response", response => { if (response.url().includes("/media/preroll-symbols/")) symbolResponses.push({ url: response.url(), status: response.status() }); });
  await desktop.addInitScript(gpuCapture);
  const response = await desktop.goto(base, { waitUntil: "domcontentloaded" });
  if (!response?.ok()) throw new Error(`Built landing returned ${response?.status()}`);
  await desktop.screenshot({ path: `${output}/symbol-first-load.png`, fullPage: true });
  if (await desktop.locator("[data-preroll-symbol]").getAttribute("src") || symbolRequests) throw new Error("Initial load requested a preroll symbol");
  await desktop.getByRole("button", { name: /Begin the showing/ }).click();
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 20000 });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-word]")?.textContent === "A STAGE" && document.querySelector("[data-preroll-symbol]")?.naturalWidth > 0, null, { timeout: 20000 });
  const desktopBounds = await desktop.evaluate(() => {
    const symbol = document.querySelector("[data-preroll-symbol-stage]")!.getBoundingClientRect();
    const copy = document.querySelector(".screen-preroll-copy")!.getBoundingClientRect();
    return { overlap: symbol.left < copy.right && symbol.right > copy.left && symbol.top < copy.bottom && symbol.bottom > copy.top };
  });
  if (desktopBounds.overlap) throw new Error("Desktop symbol box overlaps the phrase");
  await desktop.screenshot({ path: `${output}/symbol-oz-full-color-reveal.png`, fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-symbol-stage]")?.classList.contains("is-stencilled"), null, { timeout: 10000 });
  await desktop.waitForTimeout(240);
  await desktop.screenshot({ path: `${output}/symbol-oz-stencil.png`, fullPage: true });
  const gpu = await desktop.evaluate(() => (window as unknown as { __symbolFrames: { impact: boolean; pixels: number[] }[] }).__symbolFrames);
  const reveal = gpu.find(frame => !frame.impact)?.pixels;
  const impact = gpu.filter(frame => frame.impact).at(-1)?.pixels;
  const revealStats = alphaStats(reveal), impactStats = alphaStats(impact);
  const impactChanged = !!reveal?.length && !!impact?.length && reveal.some((value, index) => value !== impact[index]);
  if (!revealStats.visible || !impactStats.visible || !impactStats.transparent || !impactChanged) throw new Error(`Symbol stencil alpha/impact proof failed: ${JSON.stringify({ revealStats, impactStats, impactChanged, draws: gpu.length })}`);
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-word]")?.textContent === "UNCHARTED", null, { timeout: 25000 });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-symbol]")?.getAttribute("src")?.endsWith("uncharted-v1.webp") && document.querySelector("[data-preroll-symbol]")?.naturalWidth > 0, null, { timeout: 10000 });
  await desktop.waitForTimeout(450);
  await desktop.screenshot({ path: `${output}/symbol-uncharted.png`, fullPage: true });
  await desktop.waitForFunction(() => (document.querySelector("[data-preroll-word]")?.textContent ?? "") === "YOURS" && document.querySelector("[data-preroll-symbol]")?.getAttribute("src") === "media/bunzai-mark.png" && document.querySelector("[data-preroll-symbol]")?.naturalWidth! > 0, null, { timeout: 70000 });
  await desktop.waitForTimeout(350);
  const logoVisible = await desktop.evaluate(() => document.querySelector("[data-preroll-symbol-stage]")?.classList.contains("is-logo") && (document.querySelector("[data-preroll-symbol-stencil]") as HTMLCanvasElement | null)?.hidden === true);
  if (!logoVisible) throw new Error("The final YOURS line did not retain the Bunzai logo without a stencil");
  await desktop.screenshot({ path: `${output}/symbol-bunzai-yours.png`, fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-tagline]")?.hidden === false, null, { timeout: 5000 });
  const result = await desktop.evaluate(() => ({
    phrases: (window as unknown as { __phraseLog: { word: string; src: string }[] }).__phraseLog,
    impacts: (window as unknown as { __impactCount: string[] }).__impactCount,
    logo: document.querySelector("[data-preroll-symbol]")?.getAttribute("src"),
    logoMode: document.querySelector("[data-preroll-symbol-stage]")?.classList.contains("is-logo"),
    stencilHidden: (document.querySelector("[data-preroll-symbol-stencil]") as HTMLCanvasElement | null)?.hidden,
  }));
  if (result.phrases.length !== 32 || result.impacts.length !== 31 || result.logo !== "media/bunzai-mark.png" || !result.logoMode || !result.stencilHidden) throw new Error(`Sequence mismatch: ${JSON.stringify({ phrases: result.phrases.length, impacts: result.impacts.length, logo: result.logo, logoMode: result.logoMode, stencilHidden: result.stencilHidden })}`);
  const urls = result.phrases.slice(0, -1).map(phrase => phrase.src);
  if (new Set(urls).size !== 31 || urls.some(src => !src.endsWith(".webp"))) throw new Error("Story phrases did not use 31 distinct WebP symbols");
  const expectedUrls = [...manifest].sort((a, b) => a.index - b.index).map(row => `media/preroll-symbols/${row.slug}-v1.webp`);
  if (JSON.stringify(urls) !== JSON.stringify(expectedUrls)) throw new Error("The phrase sequence does not match its approved symbol manifest");
  const missingResponses = symbolResponses.filter(item => item.status !== 200);
  const uniqueSymbolResponses = new Set(symbolResponses.map(item => item.url));
  if (uniqueSymbolResponses.size !== 31 || missingResponses.length) throw new Error(`Symbol payloads failed: ${JSON.stringify({ responses: symbolResponses.length, unique: uniqueSymbolResponses.size, missingResponses })}`);
  await desktop.screenshot({ path: `${output}/symbol-final-tagline.png`, fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.route("https://api.github.com/**", route => route.abort());
  await mobile.goto(base, { waitUntil: "domcontentloaded" });
  await mobile.getByRole("button", { name: /Begin the showing/ }).click();
  await mobile.waitForFunction(() => document.querySelector("[data-preroll-word]")?.textContent === "A STAGE" && document.querySelector("[data-preroll-symbol]")?.naturalWidth > 0, null, { timeout: 20000 });
  await mobile.waitForFunction(() => document.querySelector("[data-preroll-word]")?.classList.contains("is-changing"), null, { timeout: 3000 });
  await mobile.waitForFunction(() => [...(document.querySelector("[data-preroll-word]")?.getAnimations() ?? [])].every(animation => animation.playState !== "running"), null, { timeout: 3000 });
  const mobileBounds = await mobile.evaluate(() => {
    const symbol = document.querySelector("[data-preroll-symbol-stage]")!.getBoundingClientRect();
    const copy = document.querySelector(".screen-preroll-copy")!.getBoundingClientRect();
    const word = document.querySelector("[data-preroll-word]")!.getBoundingClientRect();
    return { viewport: innerWidth, overlap: symbol.left < copy.right && symbol.right > copy.left && symbol.top < copy.bottom && symbol.bottom > copy.top, wordLeft: word.left, wordRight: word.right };
  });
  if (mobileBounds.overlap || mobileBounds.wordLeft < 0 || mobileBounds.wordRight > mobileBounds.viewport) throw new Error(`Mobile phrase bounds invalid: ${JSON.stringify(mobileBounds)}`);
  await mobile.screenshot({ path: `${output}/symbol-mobile-oz.png`, fullPage: true });

  const fallback = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await fallback.route("https://api.github.com/**", route => route.abort());
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (this.hasAttribute("data-preroll-symbol-stencil")) return null;
      return original.call(this, type, ...args as [never]);
    };
  });
  await fallback.goto(base, { waitUntil: "domcontentloaded" });
  await fallback.getByRole("button", { name: /Begin the showing/ }).click();
  await fallback.waitForFunction(() => document.querySelector("[data-preroll-word]")?.textContent === "A STAGE" && document.querySelector("[data-preroll-symbol-stage]")?.classList.contains("is-stencilled"), null, { timeout: 20000 });
  if (!(await fallback.locator("[data-preroll-word]").isVisible()) || !(await fallback.locator("[data-preroll-symbol]").isVisible())) throw new Error("WebGL fallback hid the phrase or transparent cutout");
  await fallback.screenshot({ path: `${output}/symbol-webgl-fallback.png`, fullPage: true });
  await fallback.getByRole("button", { name: "Skip opening" }).click();
  await fallback.waitForFunction(() => document.querySelector("[data-screen-preroll]")?.hasAttribute("hidden"));
  await fallback.getByRole("button", { name: "Replay opening" }).click();
  await fallback.waitForFunction(() => document.querySelector("[data-preroll-word]")?.textContent === "A STAGE" && document.querySelector("[data-preroll-symbol]")?.getAttribute("src") === "media/preroll-symbols/oz-v1.webp", null, { timeout: 20000 });
  await fallback.getByRole("button", { name: "Skip opening" }).click();
  await fallback.waitForFunction(() => document.querySelector("[data-screen-preroll]")?.hasAttribute("hidden"));

  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await reduced.route("https://api.github.com/**", route => route.abort());
  let reducedSymbolRequests = 0;
  reduced.on("request", request => { if (request.url().includes("/media/preroll-symbols/")) reducedSymbolRequests++; });
  await reduced.goto(base, { waitUntil: "domcontentloaded" });
  await reduced.getByRole("button", { name: /Begin the showing/ }).click();
  await reduced.waitForFunction(() => document.querySelector(".screen-slide.is-current")?.getAttribute("data-title") === "The opening title");
  if (reducedSymbolRequests || await reduced.locator("[data-preroll-symbol]").getAttribute("src")) throw new Error("Reduced motion downloaded preroll symbols");
  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({ url: base, status: response.status(), phrases: result.phrases.length, stencilImpacts: result.impacts.length, symbolResponses: symbolResponses.length, uniqueSymbolResponses: uniqueSymbolResponses.size, assetAudit: { count: assetAudit.length, minimumTransparentPixels: Math.min(...assetAudit.map(asset => asset.transparent)), minimumVisiblePixels: Math.min(...assetAudit.map(asset => asset.visible)) }, gpu: { draws: gpu.length, revealStats, impactStats, impactChanged }, desktopBounds, mobileBounds, replayAndSkip: true, reducedSymbolRequests, screenshots: output, pageErrors }, null, 2));
  await Promise.all([audit.close(), desktop.close(), mobile.close(), fallback.close(), reduced.close()]);
} finally {
  await browser.close();
}
