/** Capture the built public landing flow in Chromium without contacting external services. */
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = "http://127.0.0.1:8899/Bunzai/";
const output = resolve("dist/landing-preview/evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const errors: string[] = [];

try {
  const social = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await social.route("https://api.github.com/**", route => route.abort());
  await social.goto(base, { waitUntil: "domcontentloaded" });
  await social.screenshot({ path: join(output, "open-graph-preview.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await social.close();

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on("pageerror", error => errors.push(error.message));
  await desktop.route("https://api.github.com/**", route => route.abort());
  const desktopResponse = await desktop.goto(base, { waitUntil: "domcontentloaded" });
  if (!desktopResponse?.ok()) throw new Error("Built landing preview did not return a successful response");
  await desktop.screenshot({ path: join(output, "desktop-first-load.png"), fullPage: true });
  if (!(await desktop.locator("[data-curtain-intro]").isHidden())) throw new Error("Curtain started before Begin");
  if (!(await desktop.getByText("All the worlds: your stage", { exact: true }).count())) throw new Error("Tagline is missing from first load");
  await desktop.getByRole("button", { name: /Begin the showing/ }).click();
  await desktop.waitForFunction(() => (document.querySelector("[data-curtain-intro] video") as HTMLVideoElement | null)?.currentTime! >= 3.7, null, { timeout: 9000 });
  await desktop.screenshot({ path: join(output, "desktop-curtain-progress.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='production']")?.classList.contains("is-current"), null, { timeout: 12000 });
  await desktop.waitForTimeout(650);
  await desktop.screenshot({ path: join(output, "desktop-production-card.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='presents']")?.classList.contains("is-current"), null, { timeout: 8000 });
  await desktop.locator(".screen-preroll-type").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  if (await desktop.locator(".screen-preroll-type").textContent() !== "NOBUNNY PRESENTS") throw new Error("The NOBUNNY card did not reveal its full title");
  await desktop.screenshot({ path: join(output, "desktop-nobunny-card.png"), fullPage: true });
  await desktop.waitForFunction(() => document.querySelector("[data-preroll-card='words']")?.classList.contains("is-current"), null, { timeout: 8000 });
  await desktop.waitForTimeout(650);
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

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.route("https://api.github.com/**", route => route.abort());
  const mobileResponse = await mobile.goto(base, { waitUntil: "domcontentloaded" });
  if (!mobileResponse?.ok()) throw new Error("Mobile landing preview did not return a successful response");
  await mobile.screenshot({ path: join(output, "mobile-reduced-first-load.png"), fullPage: true });
  await mobile.getByRole("button", { name: /Begin the showing/ }).click();
  await mobile.waitForFunction(() => document.querySelector(".screen-slide.is-current")?.getAttribute("data-title") === "Scenes");
  await mobile.waitForFunction(() => (document.querySelector(".screen-slide.is-current img") as HTMLImageElement | null)?.naturalWidth! > 0, null, { timeout: 8000 });
  await mobile.waitForTimeout(700);
  await mobile.screenshot({ path: join(output, "mobile-reduced-feature-picture.png"), fullPage: true });
  if (await mobile.locator("[data-curtain-intro] video").evaluate(video => (video as HTMLVideoElement).currentSrc)) throw new Error("Reduced motion loaded the curtain video");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({ url: base, screenshots: output, desktopNextTitle: nextTitle, mobileReducedMotion: true, pageErrors: errors.length }, null, 2));
  await mobile.close();
  await desktop.close();
} finally {
  await browser.close();
}
