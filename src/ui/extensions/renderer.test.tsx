/** Purpose: verify strict extension descriptors render as inert accessible host controls. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { installDom, type InstalledDom } from "../_shared/test-dom";
import { ExtensionRenderer } from "./renderer";
import { decodeJsonValue } from "../../extensions/contracts/value";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => { installed = installDom("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1:8325/", extraGlobals: ["MouseEvent"] }); dom = installed.dom; });
afterAll(() => installed.teardown());

test("renderer binds only declared commands and resolves images from approved host assets", () => {
  const html = renderToStaticMarkup(<ExtensionRenderer packageId="demo.panel" packageName="Demo" declaredCommands={["run"]} descriptor={{ version: 1, root: { type: "stack", children: [
    { type: "button", id: "run-now", label: "Run", command: "run" },
    { type: "button", id: "bad", label: "Unavailable", command: "other" },
    { type: "image", asset: "cover", alt: "Cover" },
    { type: "image", asset: "remote", alt: "Remote" },
  ] } }} onCommand={() => undefined} assets={{ cover: "blob:host-approved" }} />);
  expect(html).toContain('aria-label="Demo extension"');
  expect(html).toContain("blob:host-approved");
  expect(html).not.toContain("Remote");
  expect(html).toContain('disabled=""');
  expect(html).not.toContain("<script");
});

test("undeclared actions cannot reach the host callback", async () => {
  const [{ flushSync }, { createRoot }, { ExtensionRenderer: Renderer }] = await Promise.all([import("react-dom"), import("react-dom/client"), import("./renderer")]);
  const calls: string[] = [];
  const host = dom.window.document.createElement("div"); dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<Renderer packageId="demo.panel" packageName="Demo" declaredCommands={["allowed"]} descriptor={{ version: 1, root: { type: "stack", children: [
    { type: "button", id: "ok", label: "Allowed", command: "allowed" },
    { type: "button", id: "no", label: "Denied", command: "denied" },
  ] } }} onCommand={(command) => calls.push(command)} />));
  const buttons = host.querySelectorAll("button");
  flushSync(() => { buttons[0]!.click(); buttons[1]!.click(); });
  expect(calls).toEqual(["allowed"]);
  flushSync(() => root.unmount()); host.remove();
});

test("renderer accepts inert null-prototype descriptors from the bounded JSON decoder", () => {
  const descriptor = decodeJsonValue({ version: 1, root: { type: "text", text: "decoded" } });
  expect(renderToStaticMarkup(<ExtensionRenderer packageId="demo.panel" packageName="Demo" declaredCommands={[]} descriptor={descriptor} onCommand={() => undefined} />)).toContain("decoded");
});
