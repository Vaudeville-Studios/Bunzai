/** Test stand-in: a valid v2 theme package built from a bundled manifest, so route and lifecycle tests never hand-write palettes. */
import type { ThemePackageInput } from "./theme-contract";
import { themeInventory } from "./theme-inventory";
import { memoryExtensionStore } from "../stage/store/memory/extension-store";
import { createExtensionService } from "./runtime/service";
import { adaptBundledThemePackage, adaptLegacyThemePackage } from "./contracts/package-validation";
import { digestJson } from "./contracts/value";
type ExtensionService = ReturnType<typeof createExtensionService>;

/** A copy of the bundled Theater package under another identity; `id` and `name` are the only edits. */
export async function fixtureThemePackage(id: string, name: string, licenseText = "Test fixture license"): Promise<ThemePackageInput> {
  // theme-key-ok: the fixture copies the bundled Theater package
  const theater = (await themeInventory()).find((input) => (input.manifest as { id: string }).id === "theater")!;
  const copy = JSON.parse(JSON.stringify(theater)) as { manifest: Record<string, unknown>; assets: Record<string, unknown> };
  copy.manifest.id = id;
  copy.manifest.name = name;
  return { ...copy, licenseText };
}

export async function unifiedThemeService(includeBuiltins = false): Promise<ExtensionService> {
  const builtinPackages = includeBuiltins ? await Promise.all((await themeInventory()).map((theme) => adaptBundledThemePackage(theme, (theme.manifest as { id: string }).id))) : [];
  let sequence = 0;
  const service = createExtensionService({ store: memoryExtensionStore(() => 1), storeId: `theme-fixture-${++sequence}`, host: "terminal", operations: [], builtinPackages,
    now: () => 1, id: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  await service.start();
  return service;
}

export async function installThemeFixture(service: ExtensionService, input: ThemePackageInput): Promise<string> {
  const pkg = await adaptLegacyThemePackage(input);
  const digest = await digestJson(pkg);
  const review = await service.preview({ schemaVersion: 1, digest, package: pkg });
  const scopes = pkg.manifest.theme?.requests ?? [];
  const control = await service.install(review.challenge, [], scopes, review.expectedRevision);
  await service.enable(control.id, control.revision);
  return control.id;
}
