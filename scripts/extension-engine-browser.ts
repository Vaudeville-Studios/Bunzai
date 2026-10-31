/** Real Chrome proof for the production sandbox-frame adapter using only ephemeral loopback fixtures. */
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { startSandboxHost } from "../src/ui/sandbox-host";
import { toErrorMessage } from "../src/error-message";

const built = await Bun.build({ entrypoints: [fileURLToPath(new URL("./extension-engine-browser-page.ts", import.meta.url))], target: "browser", format: "esm" });
if (!built.success || !built.outputs[0]) throw new Error(`fixture bundle failed: ${built.logs.map((log) => log.message).join("; ")}`);
const pageJs = await built.outputs[0].text();
let sandboxOrigin = "";
const ui = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/engine-probe.js") return new Response(pageJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
  return new Response(`<!doctype html><html><body><script type="module" src="/engine-probe.js?sandbox=${encodeURIComponent(sandboxOrigin)}"></script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
} });
const uiOrigin = `http://127.0.0.1:${ui.port}`;
const sandbox = startSandboxHost({ allowOrigin: uiOrigin });
sandboxOrigin = sandbox.origin;
const executablePath = process.env["CHROME_PATH"] ?? chromium.executablePath();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const launched = await chromium.launch({ headless: true, executablePath });
  browser = launched;
  const page = await launched.newPage();
  const consoleMessages: string[] = [], pageErrors: string[] = [], failedRequests: string[] = [];
  page.on("console", (message) => { const line = `${message.type()}: ${message.text()}`; consoleMessages.push(line); console.log(`browser console: ${line}`); });
  page.on("pageerror", (error) => { pageErrors.push(error.message); console.log(`browser page error: ${error.message}`); });
  page.on("requestfailed", (request) => { const line = `${request.url()} ${request.failure()?.errorText ?? ""}`; failedRequests.push(line); console.log(`browser request failed: ${line}`); });
  await page.goto(`${uiOrigin}/?sandbox=${encodeURIComponent(sandboxOrigin)}`);
  try { await page.waitForFunction(() => document.body.dataset.done === "true" || !!document.body.dataset.error, undefined, { timeout: 15_000 }); }
  catch (error) {
    const diagnostics = await page.evaluate(() => ({
      readyState: document.readyState, body: document.body.dataset, frames: Array.from(document.querySelectorAll("iframe")).map((frame) => ({ src: frame.getAttribute("src"), title: frame.getAttribute("title"), sandbox: frame.getAttribute("sandbox"), srcdocBytes: new TextEncoder().encode(frame.getAttribute("srcdoc") ?? "").byteLength })),
      scripts: Array.from(document.scripts).map((script) => ({ src: script.src, type: script.type, ready: script.readyState })),
    }));
    throw new Error(`browser fixture did not settle: ${JSON.stringify({ diagnostics, consoleMessages, pageErrors, failedRequests, error: toErrorMessage(error) })}`);
  }
  const actual = await page.locator("body").evaluate((body) => ({ ...(body as HTMLElement).dataset }));
  if (actual.error) throw new Error(`browser adapter failed: ${actual.error}`);
  if (actual.result !== '{"ok":true,"fetch":"undefined"}') throw new Error(`bad QuickJS browser result: ${actual.result}`);
  if (actual.cancelled !== "true") throw new Error(`browser cancellation/late reply failed: ${actual.cancelled}`);
  if (actual.forgedObserved !== "true") throw new Error("forged frame result was not observed by fixture");
  console.log(`Chrome ${launched.version()} sandbox adapter passed: ${JSON.stringify(actual)}`);
} finally {
  await browser?.close();
  sandbox.stop();
  ui.stop(true);
}
