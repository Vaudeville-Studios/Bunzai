import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  const offOrigin: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:18321") offOrigin.push(request.url());
  });
  await page.goto("http://127.0.0.1:18321/", { waitUntil: "domcontentloaded" });
  if (await page.getByText(/Choose your theme/).count()) {
    await page.screenshot({ path: "plans/evidence/public-docs-20261031/studio-first-screen.png", fullPage: true });
    await page.getByText(/Skip all/).click();
    await page.getByRole("button", { name: "Open Bunzai" }).click();
  }
  await page.waitForTimeout(1800);
  if (await page.getByRole("button", { name: "Skip" }).count()) await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "The Library" }).click();
  await page.waitForTimeout(1000);
  if (await page.getByRole("button", { name: "Skip" }).count()) await page.getByRole("button", { name: "Skip" }).click();
  await page.screenshot({ path: "plans/evidence/public-docs-20261031/studio-library.png", fullPage: true });
  await page.getByRole("button", { name: "Scenes" }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "plans/evidence/public-docs-20261031/studio-scenes.png", fullPage: true });
  console.log(JSON.stringify({ url: page.url(), errors, offOrigin }, null, 2));
  if (errors.length || offOrigin.length) throw new Error("Studio screenshot run had page errors or off-origin requests");
} finally {
  await browser.close();
}
