/** Clipboard access is a bounded, explicit host gesture after an exact-content review. */
import { z } from "zod";
import { decodeJsonValue, digestJson, type JsonValue } from "../../contracts/value";
import { MAX_EXTENSION_CLIPBOARD_BYTES } from "../../contracts/limits";
import { DESKTOP_EXTENSION_HOSTS, bindExtensionOperation, defineExtensionOperationMetadata, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const empty = z.strictObject({});
const writeInput = z.strictObject({ text: z.string().max(MAX_EXTENSION_CLIPBOARD_BYTES) });
const readOutput = z.strictObject({ text: z.string().max(MAX_EXTENSION_CLIPBOARD_BYTES) }).nullable();
const writeOutput = z.strictObject({ written: z.boolean() });
type ReadOutput = z.infer<typeof readOutput>;
type WriteInput = z.infer<typeof writeInput>;
type WriteOutput = z.infer<typeof writeOutput>;
const meta = <I, O extends JsonValue>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, receiptStatus?: (value: O) => "completed" | "conflicted" | "committed"): ExtensionOperationMetadata<I, O> => {
  /* clone-ok: secret gesture-confirmed clipboard reads/writes do not share the status metadata policy. */
  return defineExtensionOperationMetadata({
  id, title, description, input, output,
  effect: "external", sensitivity: "secret", hosts: DESKTOP_EXTENSION_HOSTS,
  policy: { resources: [], fields: ["clipboard.text"], methods: [], destinationMode: "none", destinations: [], budget: "external", confirmation: "sensitive-send" },
  estimateBudget: () => ({ bytes: MAX_EXTENSION_CLIPBOARD_BYTES + 2_000, tokens: 0 }), measureTokens: () => 0,
  ...(receiptStatus ? { receiptStatus } : {}),
  resolveAccess: () => ({ resources: [], fields: ["clipboard.text"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
  });
};

const read: ExtensionOperationDefinition<z.infer<typeof empty>, ReadOutput, ExtensionOperationServices> = {
  metadata: meta("clipboard.read", "Read clipboard text", "Read at most 64 KiB of clipboard text after a host gesture.", empty, readOutput, (value) => value === null ? "conflicted" : "completed"),
  review: async () => ({ action: "read clipboard text", maximumBytes: MAX_EXTENSION_CLIPBOARD_BYTES }),
  execute: async (_args, context, services) => {
    if (!context.access.fields.includes("clipboard.text")) throw new Error("Clipboard access is outside the approved grant.");
    if (context.host !== "desktop" || !services.hostActions) throw new Error("Clipboard access is unavailable on this host.");
    const result = await services.hostActions.request({ action: "clipboard.read", operation: "clipboard.read", packageId: context.principal.packageId, principal: {
      storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest, grantRevision: context.principal.grantRevision, runEpoch: context.principal.runEpoch,
    } }, context.signal);
    return result?.status === "read" ? { text: result.text } : null;
  },
};
const write: ExtensionOperationDefinition<WriteInput, WriteOutput, ExtensionOperationServices> = {
  metadata: meta("clipboard.write", "Write clipboard text", "Write the exact reviewed text, capped at 64 KiB, after a host gesture.", writeInput, writeOutput, (value) => value.written ? "committed" : "conflicted"),
  review: async ({ text }) => ({ action: "write clipboard text", bytes: new TextEncoder().encode(text).byteLength, digest: await digestJson(text), text }),
  execute: async ({ text }, context, services) => {
    if (!context.access.fields.includes("clipboard.text")) throw new Error("Clipboard access is outside the approved grant.");
    if (context.host !== "desktop" || !services.hostActions) throw new Error("Clipboard access is unavailable on this host.");
    const result = await services.hostActions.request({ action: "clipboard.write", operation: "clipboard.write", packageId: context.principal.packageId, principal: {
      storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest, grantRevision: context.principal.grantRevision, runEpoch: context.principal.runEpoch,
    }, text }, context.signal);
    if (result?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether clipboard text was written.");
    return { written: result?.status === "completed" };
  },
};

export const clipboardOperations = [read, write] as const;
export const createOperations = (services: ExtensionOperationServices) => clipboardOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default clipboardOperations;
