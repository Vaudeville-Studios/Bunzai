/** Binds package settings to their installed digest and fenced ExtensionStore data CAS. */
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import { decodeExtensionPackageInput, validateExtensionSettings } from "../contracts/package-validation";
import { decodeJsonValue } from "../contracts/value";
import type { ExtensionSettingsServices } from "../operations/settings/_services";
import { EXTENSION_SETTINGS_DATA_KEY } from "../operations/settings/_services";

async function packageSettings(store: ExtensionStore, packageId: string, digest: string) {
  const stored = await store.readPackage(digest);
  if (!stored) throw new Error("extension settings package is unavailable");
  const bytes = new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes);
  const parsed = JSON.parse(bytes) as unknown;
  const inspected = await decodeExtensionPackageInput(parsed);
  if (inspected.digest !== digest || inspected.package.manifest.id !== packageId || !inspected.package.manifest.settingsSchema) throw new Error("extension settings schema is unavailable");
  return { schema: inspected.package.manifest.settingsSchema, initial: inspected.package.manifest.settings };
}

export function extensionSettingsServices(store: ExtensionStore): ExtensionSettingsServices {
  return {
    async read(packageId, digest) {
      const { schema, initial } = await packageSettings(store, packageId, digest);
      const current = await store.readData(packageId, EXTENSION_SETTINGS_DATA_KEY);
      const value = current ? validateExtensionSettings(schema, current.value) : initial === undefined ? null : validateExtensionSettings(schema, initial);
      return { schema: decodeJsonValue(schema), value, revision: current?.revision ?? -1 };
    },
    async write(packageId, digest, value, expectedRevision, commit) {
      if (commit.packageId !== packageId || commit.packageDigest !== digest || commit.operation !== "settings.update") throw new Error("extension settings authority is invalid");
      const { schema } = await packageSettings(store, packageId, digest);
      const checked = validateExtensionSettings(schema, value);
      const saved = await store.compareAndSaveData(packageId, EXTENSION_SETTINGS_DATA_KEY, checked, expectedRevision, commit);
      if (saved !== "saved") return { status: "stale" };
      const current = await store.readData(packageId, EXTENSION_SETTINGS_DATA_KEY);
      if (!current || current.revision !== expectedRevision + 1) throw new Error("extension settings write did not persist");
      validateExtensionSettings(schema, current.value);
      return { status: "saved", revision: current.revision };
    },
  };
}
