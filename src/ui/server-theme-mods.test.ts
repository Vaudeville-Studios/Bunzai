/** Purpose: verify theme assets and effective appearance are read only from the unified theme projection. */
import { describe, expect, test } from "bun:test";
import type { EffectiveThemeAppearance } from "../extensions/theme-contract";
import type { SettingsStoreLike } from "../studio/contracts";
import { handleThemeReadRoutes, type ThemeReadService } from "../extensions/theme-read-routes";
import { htmlSecurityHeaders } from "./server-security";

const ID = "bunzai.theme.modtest", DIGEST = "a".repeat(64);
const effective = { themeId: ID, packageId: ID, digest: DIGEST, grantedScopes: [], appearance: null, assets: [], fonts: [], styles: "@font-face{}", slots: { "library.header": { type: "text", text: "Header" } } } as unknown as EffectiveThemeAppearance;
const service: ThemeReadService = {
  effective: async () => effective,
  asset: async (id, _asset, digest) => id === ID && digest === DIGEST ? { type: "image/png", body: new Uint8Array([1, 2, 3]) } : null,
  revisionStamp: () => ({ epoch: "epoch-1", revision: 4 }),
  markBroken: async () => undefined,
  confirmHealthy: async () => undefined,
};
const settings = { read: async () => ({ theme: ID }) } as unknown as SettingsStoreLike;
const replies = { json: (value: unknown) => Response.json(value), error: (message: string, status = 500) => Response.json({ error: message }, { status }) };
const request = (path: string, method = "GET"): [Request, URL] => { const url = new URL(`http://127.0.0.1${path}`); return [new Request(url, { method }), url]; };
const route = async (path: string, method = "GET"): Promise<Response | null> => { const [req, url] = request(path, method); return handleThemeReadRoutes(req, url, service, settings, replies); };

describe("unified theme read routes", () => {
  test("effective theme and revision return the active Extensions projection", async () => {
    expect(await (await route("/api/themes/effective"))!.json()).toMatchObject({ themeId: ID, digest: DIGEST, styles: "@font-face{}" });
    expect(await (await route("/api/themes/revision"))!.json()).toEqual({ epoch: "epoch-1", revision: 4 });
  });

  test("asset reads bind exact digest and cannot execute a document", async () => {
    const [req, url] = request(`/api/themes/assets/${ID}/backdrop?digest=${DIGEST}`);
    const result = await handleThemeReadRoutes(req, url, service, settings, replies);
    expect(result?.status).toBe(200);
    expect(result?.headers.get("content-type")).toBe("image/png");
    expect(result?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result?.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const [badRequest, badUrl] = request(`/api/themes/assets/${ID}/backdrop?digest=${"0".repeat(64)}`);
    expect((await handleThemeReadRoutes(badRequest, badUrl, service, settings, replies))?.status).toBe(404);
  });

  test("retired theme lifecycle mutations are not handled by the read router", async () => {
    expect(await route("/api/themes/broken", "POST")).toBeNull();
    expect(await route("/api/themes/healthy", "POST")).toBeNull();
  });
});

describe("page CSP", () => {
  const csp = htmlSecurityHeaders("", "'sha256-x'")["content-security-policy"]!;
  const directive = (name: string): string[] => csp.split(";").map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name)?.slice(1) ?? [];
  test("styles, fonts and images load from this origin only", () => {
    for (const name of ["style-src", "font-src", "img-src", "connect-src"]) for (const source of directive(name)) expect(source, name).not.toMatch(/^(https?:|\*|\/\/|ftp:|wss?:)/);
    expect(directive("font-src")).toEqual(["'self'"]); expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive("script-src")).not.toContain("'unsafe-eval'"); expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("base-uri")).toEqual(["'none'"]);
  });
});
