/** Theme projection and legacy import over the single ExtensionStore authority. */
import { adaptLegacyThemePackage, inspectExtensionPackage } from "../contracts/package-validation";
import type { ExtensionPackageInput } from "../contracts/package";
import { MAX_EXTENSION_PACKAGE_BYTES, canonicalJsonBytes, digestJson } from "../contracts/value";
import { themeFileBody, type EffectiveThemeAppearance, type ThemePackagePreview, type ThemeScope } from "../theme-contract";
import { deriveThemeScopes, THEME_BASE_SCOPES } from "../theme-appearance";
import { slotItemCount, type SlotId, type SlotItem, type ThemeSlots } from "../slot-registry";
import type { LegacyThemeMigration } from "../legacy-theme-migrations";
import type { ExtensionRuntimeFence, ExtensionStore, StoredExtensionControl } from "../../stage/contracts/extension-store";

export interface ExtensionThemeServiceOptions {
  store: ExtensionStore;
  builtinPackages: readonly ExtensionPackageInput[];
  legacyThemes: readonly LegacyThemeMigration[];
  safeThemes: boolean;
  policyFingerprint(scopes: readonly ThemeScope[]): Promise<string>;
}

export function createExtensionThemeService(options: ExtensionThemeServiceOptions) {
  const epoch = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  let faulted = false;
  let healthRevision = 0;
  let observedRevision = 0;
  let observedState: string | null = null;
  const core = (reason: NonNullable<EffectiveThemeAppearance["fallbackReason"]>): EffectiveThemeAppearance => ({
    themeId: null, packageId: null, digest: null, grantedScopes: [], appearance: null, assets: [], fonts: [], styles: null, slots: {}, fallbackReason: reason,
  });

  async function seed(fence: ExtensionRuntimeFence): Promise<void> {
    for (const input of options.builtinPackages) {
      const inspected = await inspectExtensionPackage(input, { allowHostTheme: true });
      const pkg = inspected.package;
      if (!pkg.manifest.id.startsWith("bunzai.host.theme.") || !inspected.theme) throw new Error("invalid host theme inventory package");
      const digest = await digestJson(pkg, MAX_EXTENSION_PACKAGE_BYTES);
      const prior = await options.store.readControl(pkg.manifest.id);
      if (prior && !prior.hostTrusted) throw new Error("host theme package id is already owned by a user package");
      await options.store.savePackage({ digest, bytes: canonicalJsonBytes(pkg, MAX_EXTENSION_PACKAGE_BYTES) }, fence);
      if (!prior) {
        const policyFingerprint = await options.policyFingerprint(inspected.theme.derivedScopes);
        const control: StoredExtensionControl = { id: pkg.manifest.id, revision: 0, packageDigest: digest, policyFingerprint, grantRevision: 0,
          grants: [], themeScopes: inspected.theme.derivedScopes, eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: true, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
        if (await options.store.compareAndSaveControl(control, -1, fence) !== "saved") throw new Error("host theme install conflicted");
      } else if (prior.packageDigest !== digest) {
        const themeScopes = prior.themeScopes.length ? inspected.theme.derivedScopes.filter((scope) => prior.themeScopes.includes(scope)) : [];
        const policyFingerprint = await options.policyFingerprint(themeScopes);
        const next = { ...prior, packageDigest: digest, themeScopes, policyFingerprint, grantRevision: prior.grantRevision + 1, revision: prior.revision + 1 };
        if (await options.store.compareAndSaveControl(next, prior.revision, fence) !== "saved") throw new Error("host theme update conflicted");
      }
    }
  }

  async function migrate(fence: ExtensionRuntimeFence): Promise<void> {
    for (const migration of options.legacyThemes) {
      const pkg = await adaptLegacyThemePackage(migration.input);
      if (!pkg.manifest.theme) throw new Error("legacy theme migration lost its appearance package");
      const id = pkg.manifest.id;
      if (await options.store.readControl(id)) continue;
      const inspected = await inspectExtensionPackage(pkg);
      if (!inspected.theme || migration.scopes.some((scope) => !inspected.theme!.derivedScopes.includes(scope))) throw new Error("legacy theme access exceeds its package");
      const digest = await digestJson(pkg, MAX_EXTENSION_PACKAGE_BYTES);
      const control: StoredExtensionControl = { id, revision: 0, packageDigest: digest, policyFingerprint: await options.policyFingerprint(migration.scopes), grantRevision: 0,
        grants: [], themeScopes: [...migration.scopes], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: migration.enabled, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
      await options.store.savePackage({ digest, bytes: canonicalJsonBytes(pkg, MAX_EXTENSION_PACKAGE_BYTES) }, fence);
      if (await options.store.compareAndSaveControl(control, -1, fence) !== "saved") throw new Error("legacy theme migration conflicted");
    }
  }

  async function record(themeId: string) {
    const packageId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(themeId)
      ? themeId : /^[a-z][a-z0-9-]{1,31}$/.test(themeId) ? `bunzai.host.theme.${themeId}` : null;
    if (!packageId) return { fallback: core("not-installed") } as const;
    const control = await options.store.readControl(packageId);
    if (!control) return { fallback: core("not-installed") } as const;
    if (!control.enabled) return { fallback: core(control.themeScopes.length ? "disabled" : "revoked") } as const;
    if (!control.themeScopes.length) return { fallback: core("revoked") } as const;
    const stored = await options.store.readPackage(control.packageDigest);
    if (!stored) return { fallback: core("invalid-state") } as const;
    try {
      const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown;
      const inspected = await inspectExtensionPackage(decoded, { allowHostTheme: control.hostTrusted });
      if (!inspected.theme || inspected.package.manifest.id !== packageId || await digestJson(inspected.package, MAX_EXTENSION_PACKAGE_BYTES) !== control.packageDigest
        || control.themeScopes.some((scope) => !inspected.theme!.derivedScopes.includes(scope))
        || THEME_BASE_SCOPES.some((scope) => !control.themeScopes.includes(scope))) return { fallback: core("invalid-state") } as const;
      return { control, preview: inspected.theme } as const;
    } catch { return { fallback: core("invalid-state") } as const; }
  }

  async function effective(themeId: string | null | undefined): Promise<EffectiveThemeAppearance> {
    if (options.safeThemes || faulted) return core("disabled");
    if (typeof themeId !== "string") return core("not-installed");
    const found = await record(themeId);
    if ("fallback" in found) return found.fallback ?? core("invalid-state");
    const p = found.preview;
    const approved = new Set(found.control.themeScopes);
    const assets = approved.has("appearance.assets") ? p.assets : [];
    const fonts = approved.has("appearance.fonts") ? p.fonts : [];
    const styles = approved.has("appearance.styles") ? p.styles : null;
    const slots: ThemeSlots = {};
    if (approved.has("ui.slots")) for (const [id, items] of Object.entries(p.slots) as [SlotId, SlotItem[]][]) {
      const visible: SlotItem[] = [];
      for (const item of items) {
        if (item.kind === "image") { if (approved.has("appearance.assets")) visible.push(item); }
        else visible.push(approved.has("appearance.styles") || item.class === undefined ? item : { kind: "text", text: item.text });
      }
      if (visible.length) slots[id] = visible;
    }
    const appearance = structuredClone(p.appearance);
    if (!approved.has("appearance.assets")) appearance.marks = {};
    const url = (assetId: string): string => `/api/themes/assets/${encodeURIComponent(found.control.id)}/${encodeURIComponent(assetId)}?digest=${p.digest}`;
    return { themeId, packageId: found.control.id, name: p.name, digest: p.digest,
      grantedScopes: deriveThemeScopes({ assets: assets.length, fonts: fonts.length, styles: styles !== null, slots: slotItemCount(slots) }), appearance,
      assets: assets.map((asset) => ({ id: asset.id, digest: asset.digest, url: url(asset.id), mediaType: asset.mediaType })),
      fonts: fonts.map((font) => ({ id: font.id, digest: font.digest, url: url(font.id), mediaType: font.mediaType })), styles, slots };
  }

  async function asset(themeId: string, assetId: string, digest: string) {
    const found = await record(themeId);
    if ("fallback" in found || found.preview.digest !== digest) return null;
    const image = found.control.themeScopes.includes("appearance.assets") ? found.preview.assets.find((item) => item.id === assetId) : undefined;
    const font = found.control.themeScopes.includes("appearance.fonts") ? found.preview.fonts.find((item) => item.id === assetId) : undefined;
    const file = image ?? font;
    return file ? themeFileBody(file) : null;
  }

  return {
    seed,
    migrate,
    effective,
    asset,
    async markBroken(themeId: string, digest: string): Promise<boolean> {
      const found = await record(themeId);
      if ("fallback" in found || found.preview.digest !== digest) return false;
      faulted = true;
      healthRevision++;
      return true;
    },
    async confirmHealthy(): Promise<void> { if (!options.safeThemes && faulted) { faulted = false; healthRevision++; } },
    async revision() {
      const controls = await options.store.listControls();
      const state = JSON.stringify({ healthRevision, controls: controls.map(({ id, revision, packageDigest, grantRevision, enabled, themeScopes }) =>
        ({ id, revision, packageDigest, grantRevision, enabled, themeScopes })).sort((a, b) => a.id.localeCompare(b.id)) });
      if (observedState !== null && observedState !== state) observedRevision++;
      observedState = state;
      return { epoch, revision: observedRevision };
    },
  };
}
