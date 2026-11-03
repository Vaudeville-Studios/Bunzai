/** Download cards accept published compatible assets and refuse missing or forged release URLs. */
import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { fillAppDownloads, publishedAppDownloads } from "./downloads";

const asset = (name: string) => ({ name, browser_download_url: `https://github.com/Vaudeville-Studios/Bunzai/releases/download/v1.2.3/${name}` });
const release = (assets: unknown[]) => [{ tag_name: "v1.2.3", assets }];

test("normal cards use actual new assets and can read older Linux x64 releases", () => {
  const raw = release([asset("Bunzai.exe"), asset("Bunzai-Linux"), asset("bunzai-cli-linux-arm64"), asset("sidecar-linux-x64")]);
  expect(publishedAppDownloads(raw, "v1.2.3").linux?.name).toBe("Bunzai-Linux");
  expect(publishedAppDownloads(release([asset("bunzai-cli-linux-x64")]), "v1.2.3").linux?.name).toBe("bunzai-cli-linux-x64");
  expect(publishedAppDownloads(release([asset("bunzai-cli-linux-arm64")]), "v1.2.3")).toEqual({});
  expect(publishedAppDownloads(release([{ name: "Bunzai.exe", browser_download_url: "https://evil.example/Bunzai.exe" }]), "v1.2.3")).toEqual({});
  expect(publishedAppDownloads(raw, "v9.9.9")).toEqual({});
  expect(publishedAppDownloads([{ ...raw[0], draft: true }], "v1.2.3")).toEqual({});
});

test("cards become usable only after a verified published link is found", () => {
  const dom = new JSDOM('<a data-app-download="linux" aria-disabled="true">Checking</a><code data-download-name="linux"></code>');
  const doc = dom.window.document;
  fillAppDownloads(doc, release([asset("Bunzai-Linux")]), "v1.2.3");
  const link = doc.querySelector("a")!;
  expect(link.getAttribute("href")).toBe(asset("Bunzai-Linux").browser_download_url);
  expect(link.hasAttribute("aria-disabled")).toBe(false);
  expect(doc.querySelector("code")!.textContent).toBe("Bunzai-Linux");
  fillAppDownloads(doc, null);
  expect(link.hasAttribute("href")).toBe(false);
  expect(link.getAttribute("aria-disabled")).toBe("true");
  dom.window.close();
});
