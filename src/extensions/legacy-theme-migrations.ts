/** Read-only validation of legacy theme rows for one-way import into ExtensionStore. */
import type { StateStore } from "../stage/contracts/state-store";
import { inspectThemePackage, type ThemePackageInput, type ThemeScope } from "./theme-contract";
import { isRecord } from "../core/guards";

export interface LegacyThemeMigration { input: ThemePackageInput; enabled: boolean; scopes: readonly ThemeScope[] }
export interface LegacyThemeImportIssue { id: string; code: "invalid-document" | "invalid-row" | "package-changed" }
export const MAX_LEGACY_THEME_STATE_BYTES = 1_800_000;

/** Invalid rows are reported and skipped; the source bytes are never changed or auto-approved. */
export async function readLegacyThemeMigrations(state?: StateStore, onIssue: (issue: LegacyThemeImportIssue) => void = () => undefined): Promise<LegacyThemeMigration[]> {
  if (!state) return [];
  const text = await state.read("themeExtensions");
  if (text === null) return [];
  if (new TextEncoder().encode(text).byteLength > MAX_LEGACY_THEME_STATE_BYTES) { onIssue({ id: "themeExtensions", code: "invalid-document" }); return []; }
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch { onIssue({ id: "themeExtensions", code: "invalid-document" }); return []; }
  if (!isRecord(raw)) { onIssue({ id: "themeExtensions", code: "invalid-document" }); return []; }
  const document = raw;
  const entries = document.entries;
  if (document.version !== 1 || !isRecord(entries)) {
    onIssue({ id: "themeExtensions", code: "invalid-document" }); return [];
  }
  const migrations: LegacyThemeMigration[] = [];
  for (const [id, value] of Object.entries(entries)) {
    if (!isRecord(value)) { onIssue({ id: id.slice(0, 120), code: "invalid-row" }); continue; }
    const row = value;
    if (row.host === true) continue;
    if (typeof row.enabled !== "boolean" || !Array.isArray(row.scopes) || typeof row.digest !== "string" || !isRecord(row.input)
      || row.scopes.some((scope) => typeof scope !== "string")
      || !isRecord(row.input.manifest) || row.input.manifest.id !== id) {
      onIssue({ id: id.slice(0, 120), code: "invalid-row" }); continue;
    }
    try {
      const scopes = row.scopes as ThemeScope[];
      const checked = await inspectThemePackage(row.input, id);
      if (checked.digest !== row.digest || !same(scopes, checked.derivedScopes)) { onIssue({ id: id.slice(0, 120), code: "package-changed" }); continue; }
      migrations.push({ input: row.input as unknown as ThemePackageInput, enabled: row.enabled, scopes: [...scopes] });
    } catch { onIssue({ id: id.slice(0, 120), code: "package-changed" }); }
  }
  return migrations;
}

const same = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort(), orderedRight = [...right].sort();
  return orderedLeft.every((value, index) => value === orderedRight[index]);
};
