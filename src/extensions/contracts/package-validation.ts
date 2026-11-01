/** Re-run authoritative appearance validators and the bounded declarative settings schema before approval. */
import { inspectThemePackage, type ThemePackageInput, type ThemePackagePreview } from "../theme-contract";
import { extensionPackageSchema, settingsDefinitionSchema, type ExtensionPackageInput } from "./package";
import { MAX_EXTENSION_PACKAGE_BYTES, decodeJsonValue, digestJson, type JsonValue } from "./value";
import { assertJavaScriptSource } from "../../sandbox/javascript/limits";
import { deepEq, isRecord } from "../../core/guards";
import { SHA256_HEX_PATTERN } from "../../core/sha256";
import { z } from "zod";

const fail = (): never => { throw new Error("invalid extension package"); };
const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : fail();

/** Inert adapter for existing v2 theme packages; executable authority and requirements remain absent. */
export async function adaptLegacyThemePackage(input: unknown, allowHostTheme = false): Promise<ExtensionPackageInput> {
  const manifest = record(record(input).manifest);
  const legacy = await inspectThemePackage(input, allowHostTheme ? String(manifest.id) : undefined);
  const theme = {
    requests: legacy.requestedScopes, appearance: legacy.appearance,
    assets: legacy.assets.map(({ id, path, mediaType }) => ({ id, path, mediaType })),
    ...(legacy.styles === null ? {} : { styles: "styles.css" as const }),
    ...(legacy.fonts.length ? { fonts: legacy.fonts.map(({ id, path, mediaType }) => ({ id, path, mediaType })) } : {}),
    ...(Object.keys(legacy.slots).length ? { slots: legacy.slots } : {}),
  };
  const files = Object.fromEntries([
    ...legacy.assets.map(({ path, text }) => [path, text]),
    ...legacy.fonts.map(({ path, text }) => [path, text]),
    ...(legacy.styles === null ? [] : [["styles.css", legacy.styles]]),
  ]);
  return extensionPackageSchema.parse({
    manifest: { schemaVersion: 1, id: legacy.id, version: legacy.version, name: legacy.name, description: "", author: "", api: { major: 1, minMinor: 0, maxMinor: 0 }, requirements: [], contributions: [], theme },
    files, ...(legacy.licenseText === undefined ? {} : { licenseText: legacy.licenseText }),
  });
}

/** Host-only adapter: reserve a namespaced control ID for a source-owned built-in appearance. */
export async function adaptBundledThemePackage(input: unknown, alias: string): Promise<ExtensionPackageInput> {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(alias)) fail();
  const source = record(input);
  const manifest = record(source.manifest);
  const internalId = `bunzai.host.theme.${alias}`;
  const renamed = { ...source, manifest: { ...manifest, id: internalId } };
  return adaptLegacyThemePackage(renamed, true);
}

function checkSetting(value: unknown, schema: Record<string, unknown>): void {
  const type = schema.type;
  if (type === "object") {
    const input = record(value), properties = record(schema.properties ?? {});
    if (Object.keys(input).some((key) => !Object.hasOwn(properties, key))) fail();
    for (const key of (schema.required as string[] | undefined) ?? []) if (!Object.hasOwn(input, key)) fail();
    for (const [key, child] of Object.entries(input)) checkSetting(child, record(properties[key]));
  } else {
    const valid = type === "string" ? typeof value === "string"
      : type === "number" ? typeof value === "number" && Number.isFinite(value)
      : type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
      : type === "boolean" ? typeof value === "boolean" : false;
    if (!valid) fail();
    if (typeof value === "number" && ((typeof schema.minimum === "number" && value < schema.minimum) || (typeof schema.maximum === "number" && value > schema.maximum))) fail();
    if (typeof value === "string" && ((typeof schema.minLength === "number" && value.length < schema.minLength) || (typeof schema.maxLength === "number" && value.length > schema.maxLength))) fail();
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((choice) => deepEq(choice, value))) fail();
}

/** Validate an update using the immutable package-owned settings schema. */
export function validateExtensionSettings(settingsSchema: unknown, value: unknown): JsonValue {
  const schema = settingsDefinitionSchema.parse(settingsSchema);
  checkSetting(value, schema as Record<string, unknown>);
  return decodeJsonValue(value);
}

/** Strictly decodes all package fields and validates theme bytes/content before a caller computes approval digest. */
export async function inspectExtensionPackage(input: unknown, options: { allowHostTheme?: boolean } = {}): Promise<{ package: ExtensionPackageInput; theme: ThemePackagePreview | null }> {
  let pkg: ExtensionPackageInput;
  const parsed = extensionPackageSchema.safeParse(input);
  if (parsed.success) pkg = parsed.data;
  else {
    const candidate = record(input);
    if (!candidate.manifest || record(candidate.manifest).schemaVersion !== 2) throw parsed.error;
    pkg = await adaptLegacyThemePackage(input);
  }
  if (pkg.manifest.id.startsWith("bunzai.host.theme.") && !options.allowHostTheme) fail();
  if (pkg.manifest.entry) assertJavaScriptSource(pkg.files[pkg.manifest.entry]!);
  const theme = pkg.manifest.theme;
  if (theme) {
    const assets = Object.fromEntries([...theme.assets, ...(theme.fonts ?? []).map((font) => font), ...(theme.styles ? [{ path: theme.styles }] : [])].map(({ path }) => [path, pkg.files[path]]));
    const manifest = { schemaVersion: 2, id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, ...theme };
    const result = await inspectThemePackage({ manifest, assets, ...(pkg.licenseText ? { licenseText: pkg.licenseText } : {}) } satisfies ThemePackageInput, pkg.manifest.id);
    if (result.id !== pkg.manifest.id || result.version !== pkg.manifest.version) fail();
    if (pkg.manifest.settingsSchema && pkg.manifest.settings !== undefined) checkSetting(pkg.manifest.settings, pkg.manifest.settingsSchema);
    return { package: pkg, theme: result };
  }
  if (pkg.manifest.settingsSchema && pkg.manifest.settings !== undefined) checkSetting(pkg.manifest.settings, pkg.manifest.settingsSchema);
  return { package: pkg, theme: null };
}

const packedArtifactSchema = z.strictObject({ schemaVersion: z.literal(1), digest: z.string().regex(SHA256_HEX_PATTERN), package: z.unknown() });
export async function decodeExtensionPackageInput(input: unknown): Promise<{ package: ExtensionPackageInput; theme: ThemePackagePreview | null; digest: string }> {
  if (isRecord(input) && Object.hasOwn(input, "schemaVersion")) {
    const artifact = packedArtifactSchema.parse(input);
    const inspected = await inspectExtensionPackage(artifact.package);
    const digest = await digestJson(inspected.package, MAX_EXTENSION_PACKAGE_BYTES);
    if (digest !== artifact.digest) throw new Error("extension artifact digest mismatch");
    return { ...inspected, digest };
  }
  const inspected = await inspectExtensionPackage(input);
  return { ...inspected, digest: await digestJson(inspected.package, MAX_EXTENSION_PACKAGE_BYTES) };
}
