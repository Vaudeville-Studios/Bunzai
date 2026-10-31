/** Purpose: prove Desktop and Terminal adapt only source-reviewed Kit discovery tools with bounded results. */
import { describe, expect, test } from "bun:test";
import { createExtensionKitTools } from "./tool-services";
import type { BunzaiDocs } from "../docs/repository";

const assertCurrent = async () => {};

describe("Terminal Kit tool adapter", () => {
  test("exposes only actual read-only docs and capability tools", async () => {
    const tools = await createExtensionKitTools("terminal");
    expect(tools.list().map(({ id }) => id)).toEqual(["docs_query", "capability_find"]);
    expect(tools.describe("shell_exec")).toBeNull();
    expect(tools.describe("docs_query")?.inputSchema).toContain("action");

    const docs = await tools.invoke("docs_query", { action: "search", query: "extension", limit: 2 }, new AbortController().signal, assertCurrent);
    expect(docs.summary).toContain("docs search");
    expect(docs.output.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(docs)).byteLength).toBeLessThanOrEqual(32_000);

    const capabilities = await tools.invoke("capability_find", { action: "browse", domain: "content", limit: 2 }, new AbortController().signal, assertCurrent);
    expect(capabilities.summary).toContain("capability browse");
    expect(capabilities.output).toContain("totalCapabilities");
  });

  test("validates each Kit tool input and denies IDs outside discovered tools", async () => {
    const tools = await createExtensionKitTools("terminal");
    await expect(tools.invoke("shell_exec", {}, new AbortController().signal, assertCurrent)).rejects.toThrow("allowlist");
    await expect(tools.invoke("docs_query", { action: "read", id: "../../secrets" }, new AbortController().signal, assertCurrent)).rejects.toThrow();
  });

  test("desktop binds the same read-only tool surface", async () => {
    const tools = await createExtensionKitTools("desktop");
    expect(tools.list().map(({ id }) => id)).toEqual(["docs_query", "capability_find"]);
    await expect(tools.invoke("shell_exec", {}, new AbortController().signal, assertCurrent)).rejects.toThrow("allowlist");
  });

  test("drops a read-only result when its activation was cancelled during the host call", async () => {
    let release!: () => void;
    const docs: BunzaiDocs = {
      search: async () => { await new Promise<void>((resolve) => { release = resolve; }); return []; },
      browse: async () => null, outline: async () => null, read: async () => null,
    };
    const tools = await createExtensionKitTools("terminal", docs);
    const controller = new AbortController();
    const result = tools.invoke("docs_query", { action: "search", query: "extension" }, controller.signal, assertCurrent);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(); release();
    await expect(result).rejects.toThrow();
  });
});
