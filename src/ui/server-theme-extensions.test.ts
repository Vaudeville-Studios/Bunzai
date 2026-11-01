/** Theme HTTP reads, example export and revision-only cross-client polling. */
import { describe, expect, test } from "bun:test";
import { memoryStateStore } from "../stage/store/memory/state-store";
import type { ThemePackageInput } from "../extensions/theme-contract";
import { createThemeRouteOwner, handleThemeReadRoutes } from "./server-theme-extensions";
import { memoryExtensionStore } from "../stage/store/memory/extension-store";
import { createExtensionService } from "../extensions/runtime/service";
import { adaptBundledThemePackage, adaptLegacyThemePackage } from "../extensions/contracts/package-validation";
import { extensionPackageSchema } from "../extensions/contracts/package";
import { themeInventory } from "../extensions/theme-inventory";
import { digestJson } from "../extensions/contracts/value";
import { THEME_BASE_SCOPES } from "../extensions/theme-appearance";
import { err, json } from "./server-security";

const settings = { read: async () => ({ theme: "theater" }) } as never;
const request = (path: string): [Request, URL] => {
  const url = new URL(`http://127.0.0.1${path}`);
  return [new Request(url), url];
};
const readThemeRoute = (req: Request, url: URL, reader: Parameters<typeof handleThemeReadRoutes>[2], store: Parameters<typeof handleThemeReadRoutes>[3]) =>
  handleThemeReadRoutes(req, url, reader, store, { json, error: err });

describe("theme route owner refuses the retired StateStore authority", () => {
  const packages = async (state: ReturnType<typeof memoryStateStore>): Promise<Response> => {
    const [req, url] = request("/api/themes/packages");
    return createThemeRouteOwner(undefined, settings)(req, url, state);
  };

  test("invalid legacy theme state cannot become a second reader or writer", async () => {
    const state = memoryStateStore();
    const res = await packages(state);
    expect(res.status).toBe(503);
    expect(await state.read("themeExtensions")).toBeNull();
  });

  test("unreadable legacy theme state stays untouched and is not served", async () => {
    const state = memoryStateStore();
    await state.write("themeExtensions", "{broken");
    const res = await packages(state);
    expect(res.status).toBe(503);
    expect(await state.read("themeExtensions")).toBe("{broken");
  });

  test("the route owner resolves the full bundled theme inventory beside executable extension examples", async () => {
    const store = memoryExtensionStore(() => 1);
    let sequence = 0;
    const builtins = await Promise.all((await themeInventory()).map(async (theme) => adaptBundledThemePackage(theme, (theme.manifest as { id: string }).id)));
    const service = createExtensionService({ store, storeId: "route-theme-fixture", host: "terminal", operations: [], builtinPackages: builtins,
      now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
    await service.start();
    const owner = createThemeRouteOwner(undefined, settings);
    const [req, url] = request("/api/themes/effective");
    const reader = { effective: service.themeEffective, asset: service.themeAsset, revisionStamp: service.themeRevision,
      markBroken: service.themeMarkBroken, confirmHealthy: service.themeConfirmHealthy };
    const response = await owner(req, url, undefined, reader);
    expect(response.status).toBe(200);
    const effective = await response.json() as { themeId: string | null; appearance: unknown };
    expect(effective.themeId).toBe("theater");
    expect(effective.appearance).not.toBeNull();
    expect((await service.list()).filter((item) => item.hostTrusted)).toHaveLength(4);
    await service.close();
  });

  test("unified reader mode refuses legacy theme lifecycle writers", async () => {
    const state = memoryStateStore();
    const reader = { effective: async () => ({ themeId: null, packageId: null, digest: null, grantedScopes: [], appearance: null, assets: [], fonts: [], styles: null, slots: {} }),
      asset: async () => null, revisionStamp: () => ({ epoch: "a".repeat(48), revision: 0 }) } as never;
    const owner = createThemeRouteOwner(undefined, settings);
    const url = new URL("http://127.0.0.1/api/themes/install");
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: "legacy" }) });
    const response = await owner(req, url, state, reader);
    expect(response.status).toBe(410);
    expect(await state.read("themeExtensions")).toBeNull();
  });

  test("theme selection and its asset route resolve from the extension store after install", async () => {
    const store = memoryExtensionStore(() => 1);
    let sequence = 0;
    let selected = "theater";
    const builtins = await Promise.all((await themeInventory()).map(async (theme) =>
      adaptBundledThemePackage(theme, (theme.manifest as { id: string }).id)));
    const service = createExtensionService({ store, storeId: "theme-fixture", host: "terminal", operations: [], builtinPackages: builtins,
      now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
    await service.start();
    const builtin = await service.themeEffective(selected);
    expect(builtin.packageId).toBe("bunzai.host.theme.theater");
    expect(await service.list()).toContainEqual(expect.objectContaining({ id: "bunzai.host.theme.theater", hostTrusted: true, enabled: true }));

    const stage = (await themeInventory()).find((theme) => (theme.manifest as { id: string }).id === "stage")!;
    const legacy = JSON.parse(JSON.stringify(stage)) as ThemePackageInput;
    (legacy.manifest as { id: string; name: string }).id = "bunzai.theme.encore";
    (legacy.manifest as { name: string }).name = "Encore";
    const legacyPackage = await adaptLegacyThemePackage(legacy);
    const extensionPackage = extensionPackageSchema.parse({ ...legacyPackage,
      manifest: { ...legacyPackage.manifest, id: "example.runtime-theme", entry: "main.js" },
      files: { ...legacyPackage.files, "main.js": "bunzai.extension.define({commands:{run:()=>null}});" },
    });
    const artifact = { schemaVersion: 1, digest: await digestJson(extensionPackage), package: extensionPackage };
    const review = await service.preview(artifact);
    const scopes = extensionPackage.manifest.theme!.requests;
    const installed = await service.install(review.challenge, [], scopes, review.expectedRevision);
    await service.enable(installed.id, installed.revision);
    selected = installed.id;

    const reader = { effective: service.themeEffective, asset: service.themeAsset, revisionStamp: service.themeRevision, markBroken: service.themeMarkBroken, confirmHealthy: service.themeConfirmHealthy };
    const [effectiveReq, effectiveUrl] = request("/api/themes/effective");
    const effectiveResponse = await readThemeRoute(effectiveReq, effectiveUrl, reader, { read: async () => ({ theme: selected }) } as never);
    const effective = await effectiveResponse!.json() as { packageId: string; assets: { id: string; url: string }[] };
    expect(installed.id).toBe("example.runtime-theme");
    expect(effective.packageId).toBe(installed.id);
    expect(effective.assets.length).toBeGreaterThan(0);
    const asset = effective.assets[0]!;
    const [assetReq, assetUrl] = request(asset.url);
    const assetResponse = await readThemeRoute(assetReq, assetUrl, reader, settings);
    expect(assetResponse?.status).toBe(200);
    expect(assetResponse?.headers.get("x-content-type-options")).toBe("nosniff");
    const owner = createThemeRouteOwner(undefined, settings);
    const brokenUrl = new URL("http://127.0.0.1/api/themes/broken");
    const brokenRequest = new Request(brokenUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected, digest: effective.assets[0]!.url.split("digest=")[1] }) });
    expect((await owner(brokenRequest, brokenUrl, undefined, reader)).status).toBe(200);
    expect((await service.themeEffective(selected)).fallbackReason).toBe("disabled");
    const healthyUrl = new URL("http://127.0.0.1/api/themes/healthy");
    const healthyRequest = new Request(healthyUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect((await owner(healthyRequest, healthyUrl, undefined, reader)).status).toBe(200);
    expect((await service.themeEffective(selected)).packageId).toBe(installed.id);
    await service.close();
  });

  test("unapproved optional appearance scopes are absent from effective data and asset reads", async () => {
    const store = memoryExtensionStore(() => 1);
    let sequence = 0;
    const stage = (await themeInventory()).find((theme) => (theme.manifest as { id: string }).id === "stage")!;
    const legacy = JSON.parse(JSON.stringify(stage)) as ThemePackageInput;
    (legacy.manifest as { id: string; name: string }).id = "bunzai.theme.partial";
    (legacy.manifest as { name: string }).name = "Partial";
    const adapted = await adaptLegacyThemePackage(legacy);
    const input = extensionPackageSchema.parse({ ...adapted, manifest: { ...adapted.manifest, id: "example.partial-theme", entry: "main.js" },
      files: { ...adapted.files, "main.js": "bunzai.extension.define({commands:{}});" } });
    const service = createExtensionService({ store, storeId: "partial-theme-fixture", host: "terminal", operations: [],
      now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
    await service.start();
    const preview = await service.preview({ schemaVersion: 1, digest: await digestJson(input), package: input });
    const installed = await service.install(preview.challenge, [], [...THEME_BASE_SCOPES], preview.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const effective = await service.themeEffective(installed.id);
    expect(effective.grantedScopes).toEqual([...THEME_BASE_SCOPES].sort());
    expect(effective.assets).toEqual([]);
    expect(effective.fonts).toEqual([]);
    expect(effective.styles).toBeNull();
    expect(effective.slots).toEqual({});
    expect(effective.appearance?.marks).toEqual({});
    expect(await service.themeAsset(installed.id, preview.package.manifest.theme!.assets[0]!.id, effective.digest!)).toBeNull();
    await service.close();
  });
});
