/** Fenced host-visible command registration changes over the canonical ExtensionStore control record. */
import type { ExtensionCommandServices } from "../operations/commands/_services";
import type { ExtensionCommitContext, ExtensionStore } from "../../stage/contracts/extension-store";
import { inspectExtensionPackage } from "../contracts/package-validation";
import { contributionIdSchema } from "../contracts/contribution-id";

const decodePackage = async (store: ExtensionStore, digest: string) => {
  const stored = await store.readPackage(digest);
  if (!stored) throw new Error("installed extension package is unavailable");
  return (await inspectExtensionPackage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown)).package;
};

export function extensionCommandServices(store: ExtensionStore): ExtensionCommandServices {
  return {
    async registered(packageId) {
      const control = await store.readControl(packageId);
      return control ? [...control.registeredCommands] : [];
    },
    async replaceRegistered(packageId, commandIds, commit: ExtensionCommitContext) {
      if (commit.operation !== "commands.register" || commit.packageId !== packageId) throw new Error("command registration principal mismatch");
      const control = await store.readControl(packageId);
      if (!control || !control.enabled || control.recoveryRequired || control.packageDigest !== commit.packageDigest
        || control.policyFingerprint !== commit.policyFingerprint || control.grantRevision !== commit.grantRevision) throw new Error("command registration authority changed");
      const pkg = await decodePackage(store, control.packageDigest);
      const declared = pkg.manifest.contributions.filter((part) => part.type === "command").map((part) => part.id);
      const parsedIds = commandIds.map((id) => contributionIdSchema.parse(id));
      if (new Set(parsedIds).size !== parsedIds.length || parsedIds.length > 64 || parsedIds.some((id) => !declared.includes(id))) {
        throw new Error("registered commands must be an exact subset of this package manifest");
      }
      const next = { ...control, registeredCommands: parsedIds, revision: control.revision + 1 };
      const status = await store.compareAndSaveControl(next, control.revision, commit);
      return status === "saved"
        ? { status, registered: [...next.registeredCommands], revision: next.revision }
        : { status, registered: [...control.registeredCommands], revision: control.revision };
    },
  };
}
