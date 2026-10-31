/** Capture the built public landing flow in Chromium without contacting external services. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.env.PAGES_PREVIEW_URL ?? "http://127.0.0.1:8899/Bunzai/";
const output = resolve("dist/landing-preview/evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const errors: string[] = [];
const gpuCapture = `(() => {
  const samples = {};
  Object.defineProperty(window, "__bunzaiGpuSamples", { value: samples });
  const record = gl => {
    const canvas = gl.canvas;
    const role = canvas.hasAttribute("data-preroll-world-stencil") ? "world" : canvas.hasAttribute("data-preroll-chrome") ? "chrome" : "";
    if (!role) return;
    const phase = document.querySelector("[data-preroll-worlds]")?.classList.contains("is-stencilled") ? "impact" : "reveal";
    if (samples[role]?.[phase]) return;
    const points = [];
    for (let row = 1; row <= 5; row++) for (let column = 1; column <= 5; column++) {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.round(canvas.width * column / 6), Math.round(canvas.height * row / 6), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      points.push(...pixel);
    }
    (samples[role] ??= {})[phase] = points;
  };
  for (const Context of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Context) continue;
    const prototype = Context.prototype;
    for (const name of ["drawArrays", "drawElements"]) {
      if (!Object.prototype.hasOwnProperty.call(prototype, name)) continue;
      const draw = prototype[name];
      prototype[name] = function (...args) { draw.apply(this, args); record(this); };
    }
  }
})()`;
const sampleSummary = (samples: number[] | undefined) => ({
  samples: samples?.length ?? 0,
  opaque: samples?.filter((value, index) => index % 4 === 3 && value > 16).length ?? 0,
  signature: samples?.filter((_, index) => index % 4 !== 3).join(",") ?? "",
});

try {
  const social = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await social.route("https://api.github.com/**", route => route.abort());
  await social.goto(base, { waitUntil: "domcontentloaded" });
  await social.screenshot({ path: join(output, "open-graph-preview.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await social.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("pageerror", error => errors.push(error.message));
  let deferredWorldRequests = 0;
  desktop.on("request", request => { if (request.url().includes("/media/preroll-world-")) deferredWorldRequests++; });
  await desktop.addInitScript(gpuCapture);
  await desktop.route("https://api.github.com/**", route => route.abort());
  const desktopResponse = await desktop.goto(base, { waitUntil: "domcontentloaded" });
  if (!desktopResponse?.ok()) throw new Error("Built landing preview did not return a successful response");
  await desktop.screenshot({ path: join(output, "desktop-first-load.png"), fullPage: true });
  if (!(await desktop.locator("[data-curtain-intro]").isHidden())) throw new Error("Curtain started before Begin");
  if (!(await desktop.getByText("All the worlds: your stage", { exact: true }).count())) throw new Error("Tagline is missing from first load");
  if (await desktop.locator("[data-preroll-world]").evaluateAll(images => images.some(image => image.hasAttribute("src"))) || deferredWorldRequests) throw new Error("Opening frame eagerly requested a preroll world image");
  await desktop.getByRole("button", { name: /Begin the showing/ }).click();
  await desktop.waitForFunction(() => (document.querySelector("[data-curtain-intro] video") as HTMLVideoElement | null)?.currentTime! >= 3.7, null, { timeout: 9000 });
  await desktop.screenshot({ path: join(output, "desktop-curtain-progress.png"), fullPage: true });
  await desktop.waitForFunction(() => !document.querySelector("[data-screen-preroll]")?.hasAttribute("hidden") && document.querySelector("[data-preroll-card='production']")?.classList.contains("is-current"), null, { timeout: 12000 });
  await desktop.waitForTimeout(650);
  await desktop.screenshot({ path: join(output, "desktop-production-card.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='presents']")?.classList.contains("is-current"), null, { timeout: 8000 });
  await desktop.locator(".screen-preroll-type").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  if (await desktop.locator(".screen-preroll-type").textContent() !== "VAUDEVILLE PRESENTS") throw new Error("The Vaudeville card did not reveal its full title");
  await desktop.screenshot({ path: join(output, "desktop-vaudeville-card.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 8000 });
  await desktop.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>("[data-preroll-world].is-current");
    const canvas = document.querySelector<HTMLCanvasElement>("[data-preroll-world-stencil]");
    return image?.naturalWidth && canvas?.width && canvas.height;
  }, null, { timeout: 12000 });
  await desktop.screenshot({ path: join(output, "desktop-world-gpu-start.png"), fullPage: true });
  const worldWebgl = await desktop.locator("[data-preroll-world-stencil]").evaluate(canvas => {
    const surface = canvas as HTMLCanvasElement;
    const gl = surface.getContext("webgl2") ?? surface.getContext("webgl");
    return { active: !!gl && !gl.isContextLost(), width: surface.width, height: surface.height };
  });
  if (!worldWebgl.active || !worldWebgl.width || !worldWebgl.height) throw new Error("Chromium did not create the story-world WebGL reveal context");
  const revealMode = await desktop.locator("[data-preroll-world].is-current").evaluate(image => ({
    fullColor: getComputedStyle(image).filter === "none",
    unstencilled: !document.querySelector("[data-preroll-worlds]")?.classList.contains("is-stencilled"),
  }));
  if (!revealMode.fullColor || !revealMode.unstencilled) throw new Error("Story-world reveal did not hold in full color before impact");
  await desktop.screenshot({ path: join(output, "desktop-world-full-color-reveal.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-worlds]")?.classList.contains("is-stencilled"), null, { timeout: 5000 });
  await desktop.waitForFunction(() => document.querySelector(".screen-preroll-word-stage")?.getAnimations().some(animation => animation.playState === "running"), null, { timeout: 2000 });
  await desktop.waitForTimeout(250);
  const gpuSamples = await desktop.evaluate(() => (window as unknown as {
    __bunzaiGpuSamples?: Record<string, Record<string, number[]>>;
  }).__bunzaiGpuSamples ?? {});
  const worldReveal = sampleSummary(gpuSamples.world?.reveal);
  const worldImpact = sampleSummary(gpuSamples.world?.impact);
  const chromeReveal = sampleSummary(gpuSamples.chrome?.reveal);
  const chromeImpact = sampleSummary(gpuSamples.chrome?.impact);
  const changed = (before: number[] | undefined, after: number[] | undefined): boolean =>
    !!before?.length && !!after?.length && before.some((value, index) => value !== after[index]);
  if (!worldReveal.opaque || !worldImpact.opaque || !changed(gpuSamples.world?.reveal, gpuSamples.world?.impact)) throw new Error("The stencil GPU readback did not show opaque pixels changing at impact");
  if (!chromeReveal.opaque || !chromeImpact.opaque || !changed(gpuSamples.chrome?.reveal, gpuSamples.chrome?.impact)) throw new Error("The chrome GPU readback did not show opaque pixels changing with the word hit");
  await desktop.screenshot({ path: join(output, "desktop-world-colored-stencil.png"), fullPage: true });
  const worldLost = await desktop.locator("[data-preroll-world-stencil]").evaluate(canvas => {
    const surface = canvas as HTMLCanvasElement;
    const gl = (surface.getContext("webgl2") ?? surface.getContext("webgl")) as WebGLRenderingContext | null;
    const lose = gl?.getExtension("WEBGL_lose_context");
    if (!lose) return false;
    lose.loseContext();
    return true;
  });
  if (!worldLost) throw new Error("Chromium does not expose the WebGL context-loss test extension");
  await desktop.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-preroll-world-stencil]");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    return !!gl?.isContextLost();
  }, null, { timeout: 5000 });
  if (!(await desktop.locator("[data-preroll-world].is-current").isVisible())) throw new Error("Source image disappeared after WebGL context loss");
  await desktop.screenshot({ path: join(output, "desktop-world-context-loss-fallback.png"), fullPage: true });
  const chromeLost = await desktop.locator("[data-preroll-chrome]").evaluate(canvas => {
    const surface = canvas as HTMLCanvasElement;
    const gl = (surface.getContext("webgl2") ?? surface.getContext("webgl")) as WebGLRenderingContext | null;
    const lose = gl?.getExtension("WEBGL_lose_context");
    if (!lose) return false;
    lose.loseContext();
    return true;
  });
  if (!chromeLost) throw new Error("Chromium does not expose the chrome context-loss test extension");
  await desktop.waitForFunction(() => !!document.querySelector(".screen-preroll-word-stage")?.textContent?.trim());
  if (!(await desktop.locator("[data-preroll-word]").isVisible())) throw new Error("DOM phrase disappeared after chrome context loss");
  await desktop.screenshot({ path: join(output, "desktop-chrome-context-loss-fallback.png"), fullPage: true });
  await desktop.screenshot({ path: join(output, "desktop-word-run.png"), fullPage: true });
  await desktop.waitForFunction(() => !(document.querySelector("[data-preroll-tagline]") as HTMLElement | null)?.hidden, null, { timeout: 35000 });
  await desktop.screenshot({ path: join(output, "desktop-final-tagline.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-screen-preroll]")?.hasAttribute("hidden"), null, { timeout: 5000 });
  const openingTitle = await desktop.locator(".screening-caption output").textContent();
  if (openingTitle !== "Scenes") throw new Error(`Expected first feature picture after opening, got ${openingTitle}`);
  await desktop.waitForFunction(() => (document.querySelector(".screen-slide.is-current img") as HTMLImageElement | null)?.naturalWidth! > 0, null, { timeout: 8000 });
  await desktop.waitForTimeout(700);
  await desktop.screenshot({ path: join(output, "desktop-feature-picture.png"), fullPage: true });
  await desktop.getByRole("button", { name: "Next picture" }).click();
  const nextTitle = await desktop.locator(".screening-caption output").textContent();
  if (nextTitle === openingTitle) throw new Error("Next picture did not change the screening");
  await desktop.waitForFunction(() => (document.querySelector(".screen-slide.is-current img") as HTMLImageElement | null)?.naturalWidth! > 0, null, { timeout: 8000 });
  await desktop.waitForTimeout(700);
  await desktop.screenshot({ path: join(output, "desktop-next-picture.png"), fullPage: true });
  await desktop.getByRole("button", { name: "Replay opening" }).click();
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='production']")?.classList.contains("is-current"), null, { timeout: 5000 });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='presents']")?.classList.contains("is-current"), null, { timeout: 8000 });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 8000 });
  if (await desktop.locator("[data-preroll-word]").textContent() !== "A STAGE") throw new Error("Replay did not reset the phrase sequence");
  if (await desktop.locator("[data-preroll-world].is-current").getAttribute("data-preroll-world") !== "oz") throw new Error("Replay did not reset the world chapter");
  await desktop.screenshot({ path: join(output, "desktop-replay-reset.png"), fullPage: true });
  await desktop.getByRole("button", { name: "Skip opening" }).click();
  await desktop.waitForFunction(() => document.querySelector("[data-screen-preroll]")?.hasAttribute("hidden"), null, { timeout: 5000 });

  const fallback = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (this.hasAttribute("data-preroll-world-stencil") || this.hasAttribute("data-preroll-chrome")) return null;
      return original.call(this, type, ...args as [never]);
    };
  });
  await fallback.route("https://api.github.com/**", route => route.abort());
  await fallback.goto(base, { waitUntil: "domcontentloaded" });
  await fallback.getByRole("button", { name: /Begin the showing/ }).click();
  await fallback.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 30000 });
  await fallback.waitForFunction(() => document.querySelector("[data-preroll-worlds]")?.classList.contains("is-stencilled"), null, { timeout: 15000 });
  if (!(await fallback.locator("[data-preroll-word]").isVisible()) || !(await fallback.locator("[data-preroll-world].is-current").isVisible())) throw new Error("CSS fallback hid the source phrase or image");
  await fallback.screenshot({ path: join(output, "desktop-forced-webgl-fallback.png"), fullPage: true });
  await fallback.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  mobile.on("pageerror", error => errors.push(error.message));
  let reducedWorldRequests = 0;
  mobile.on("request", request => { if (request.url().includes("/media/preroll-world-")) reducedWorldRequests++; });
  await mobile.route("https://api.github.com/**", route => route.abort());
  const mobileResponse = await mobile.goto(base, { waitUntil: "domcontentloaded" });
  if (!mobileResponse?.ok()) throw new Error("Mobile landing preview did not return a successful response");
  await mobile.screenshot({ path: join(output, "mobile-reduced-first-load.png"), fullPage: true });
  await mobile.getByRole("button", { name: /Begin the showing/ }).click();
  await mobile.waitForFunction(() => document.querySelector(".screen-slide.is-current")?.getAttribute("data-title") === "Scenes");
  if (await mobile.locator("[data-preroll-world]").evaluateAll(images => images.some(image => image.hasAttribute("src"))) || reducedWorldRequests) throw new Error("Reduced motion requested a preroll world image");
  await mobile.waitForFunction(() => (document.querySelector(".screen-slide.is-current img") as HTMLImageElement | null)?.naturalWidth! > 0, null, { timeout: 8000 });
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: join(output, "mobile-reduced-feature-picture.png"), fullPage: true });
  if (await mobile.locator("[data-curtain-intro] video").evaluate(video => (video as HTMLVideoElement).currentSrc)) throw new Error("Reduced motion loaded the curtain video");

  const mobileFilm = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobileFilm.route("https://api.github.com/**", route => route.abort());
  await mobileFilm.goto(base, { waitUntil: "domcontentloaded" });
  await mobileFilm.getByRole("button", { name: /Begin the showing/ }).click();
  await mobileFilm.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 30000 });
  await mobileFilm.waitForFunction(() => document.querySelector("[data-preroll-worlds]")?.classList.contains("is-stencilled"), null, { timeout: 15000 });
  await mobileFilm.screenshot({ path: join(output, "mobile-world-stencil.png"), fullPage: true });
  await mobileFilm.waitForFunction(() => {
    const stage = document.querySelector(".screen-preroll-word-stage");
    return !!stage && stage.getAnimations().every(animation => animation.playState !== "running");
  }, null, { timeout: 5000 });
  if (!(await mobileFilm.locator("[data-preroll-word]").isVisible())) throw new Error("Settled mobile phrase is not visible");
  const mobileBounds = await mobileFilm.locator(".screen-preroll-word-stage").evaluate(stage => {
    const rect = stage.getBoundingClientRect();
    const canvas = stage.querySelector("[data-preroll-chrome]")!.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, canvasWidth: canvas.width, viewport: innerWidth };
  });
  if (mobileBounds.left < 0 || mobileBounds.right > mobileBounds.viewport || Math.abs(mobileBounds.width - mobileBounds.canvasWidth) > 1) throw new Error("Settled mobile phrase or chrome canvas is clipped/misaligned");
  await mobileFilm.screenshot({ path: join(output, "mobile-world-stencil-settled.png"), fullPage: true });
  await mobileFilm.close();
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({ url: base, screenshots: output, desktopNextTitle: nextTitle, worldWebgl, gpuSamples: { worldReveal, worldImpact, chromeReveal, chromeImpact }, contextLossFallbacks: true, replayReset: true, forcedWebglFallback: true, mobileBounds, mobileReducedMotion: true, pageErrors: errors.length }, null, 2));
  await mobile.close();
  await desktop.close();
} finally {
  await browser.close();
}
