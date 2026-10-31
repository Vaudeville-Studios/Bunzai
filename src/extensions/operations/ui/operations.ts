/** Bounded, host-drawn UI contributions and explicit extension-branded dialog requests. */
import { z } from "zod";
import { interactiveDescriptorSchema, validateInteractiveDescriptor } from "../../contracts/interactive";
import { BROWSER_EXTENSION_HOSTS, bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionRunPrincipal } from "../../contracts/host-actions";
import { KIND_IDS } from "../../../generated/kinds";

const principal = (value: { storeId: string; packageId: string; packageDigest: string; grantRevision: number; runEpoch: number }): ExtensionRunPrincipal => ({
  storeId: value.storeId, packageId: value.packageId, packageDigest: value.packageDigest, grantRevision: value.grantRevision, runEpoch: value.runEpoch,
});
const input = {
  panelSet: z.strictObject({ contributionId: z.string().min(1).max(80), descriptor: interactiveDescriptorSchema }),
  panelRemove: z.strictObject({ contributionId: z.string().min(1).max(80) }),
  notice: z.strictObject({ text: z.string().min(1).max(2_000) }),
  dialog: z.strictObject({ message: z.string().min(1).max(2_000) }),
  status: z.strictObject({ text: z.string().max(500).nullable() }),
  sceneOpen: z.strictObject({ sceneId: z.string().min(1).max(160) }),
  editorOpen: z.strictObject({ kind: z.enum(KIND_IDS), id: z.string().min(1).max(160) }),
};
const output = {
  changed: z.strictObject({ changed: z.boolean() }),
  dialog: z.strictObject({ accepted: z.boolean() }),
  done: z.strictObject({ shown: z.literal(true) }),
  opened: z.strictObject({ opened: z.boolean() }),
};
type InputByName = { panelSet: z.infer<typeof input.panelSet>; panelRemove: z.infer<typeof input.panelRemove>; notice: z.infer<typeof input.notice>; dialog: z.infer<typeof input.dialog>; status: z.infer<typeof input.status>; sceneOpen: z.infer<typeof input.sceneOpen>; editorOpen: z.infer<typeof input.editorOpen> };
type OutputByName = { changed: z.infer<typeof output.changed>; dialog: z.infer<typeof output.dialog>; done: z.infer<typeof output.done>; opened: z.infer<typeof output.opened> };
type UiKey = keyof InputByName;
const fields: Record<UiKey, string> = { panelSet: "panel", panelRemove: "panel", notice: "notice", dialog: "dialog", status: "status", sceneOpen: "navigation.scene", editorOpen: "navigation.editor" };
const resourceKinds: Record<UiKey, readonly string[]> = { panelSet: [], panelRemove: [], notice: [], dialog: [], status: [], sceneOpen: ["scene"], editorOpen: KIND_IDS };
const navigationAccess = (key: UiKey, args: InputByName[UiKey]) => key === "sceneOpen"
  ? [{ kind: "scene", id: (args as InputByName["sceneOpen"]).sceneId }]
  : key === "editorOpen" ? [{ kind: (args as InputByName["editorOpen"]).kind, id: (args as InputByName["editorOpen"]).id }] : [];
const metadata = <K extends UiKey, O extends OutputByName[keyof OutputByName]>(id: string, title: string, description: string, key: K, result: z.ZodType<O>, receiptStatus?: (value: O) => "completed" | "conflicted" | "committed"): ExtensionOperationMetadata<InputByName[K], O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input: input[key] as unknown as z.ZodType<InputByName[K]>, output: result,
  effect: "control", sensitivity: "private", hosts: BROWSER_EXTENSION_HOSTS,
  policy: { resources: resourceKinds[key], fields: [fields[key]], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
  estimateBudget: (value) => ({ bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength + 1_000, tokens: 0 }), measureTokens: () => 0,
  ...(receiptStatus ? { receiptStatus } : {}),
  resolveAccess: (args) => ({ resources: navigationAccess(key, args as InputByName[UiKey]), fields: [fields[key]], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
});

const panelSet: ExtensionOperationDefinition<InputByName["panelSet"], OutputByName["changed"], ExtensionOperationServices> = {
  metadata: metadata("ui.panel.set", "Update an extension panel", "Set a bounded host-rendered panel declared by this package.", "panelSet", output.changed, (value) => value.changed ? "committed" : "conflicted"),
  execute: async ({ contributionId, descriptor: raw }, context, services) => {
    if (!context.declaredPanels?.includes(contributionId)) throw new Error("PERMISSION_DENIED: this panel contribution is not declared by the package");
    const descriptor = validateInteractiveDescriptor(raw, { commands: context.declaredCommands ?? [], assets: context.declaredAssets ?? [] });
    const changed = services.hostActions?.setPanel({ packageId: context.principal.packageId, principal: principal(context.principal), digest: context.principal.packageDigest, contributionId, descriptor }) ?? false;
    if (!changed) throw new Error("PERMISSION_DENIED: this extension panel is unavailable or stale");
    return { changed };
  },
};
const panelRemove: ExtensionOperationDefinition<InputByName["panelRemove"], OutputByName["changed"], ExtensionOperationServices> = {
  metadata: metadata("ui.panel.remove", "Remove an extension panel", "Remove one panel contributed by this package.", "panelRemove", output.changed, (value) => value.changed ? "committed" : "conflicted"),
  execute: ({ contributionId }, context, services) => Promise.resolve({ changed: services.hostActions?.removePanel(context.principal.packageId, contributionId, principal(context.principal)) ?? false }),
};
const notice: ExtensionOperationDefinition<InputByName["notice"], OutputByName["done"], ExtensionOperationServices> = {
  metadata: metadata("ui.notice.show", "Show an extension notice", "Show a bounded message in the host extension manager.", "notice", output.done),
  execute: ({ text }, context, services) => {
    if (!services.hostActions) throw new Error("UNSUPPORTED_HOST: extension notices are unavailable");
    services.hostActions.showNotice(context.principal.packageId, principal(context.principal), text);
    return Promise.resolve({ shown: true });
  },
};
const dialog: ExtensionOperationDefinition<InputByName["dialog"], OutputByName["dialog"], ExtensionOperationServices> = {
  metadata: metadata("ui.dialog.request", "Request an extension dialog", "Ask the host to show a branded, text-only extension question.", "dialog", output.dialog, () => "completed"),
  execute: async ({ message }, context, services) => {
    if (!services.hostActions) throw new Error("UNSUPPORTED_HOST: extension dialogs are unavailable");
    const answer = await services.hostActions.request({ action: "ui.dialog.request", operation: "ui.dialog.request", packageId: context.principal.packageId, principal: principal(context.principal), message }, context.signal);
    return { accepted: answer?.status === "accepted" };
  },
};
const status: ExtensionOperationDefinition<InputByName["status"], OutputByName["changed"], ExtensionOperationServices> = {
  metadata: metadata("ui.status.set", "Set extension status", "Set or clear a short status line in the host extension manager.", "status", output.changed, (value) => value.changed ? "committed" : "conflicted"),
  execute: ({ text }, context, services) => Promise.resolve({ changed: services.hostActions?.setStatus({ packageId: context.principal.packageId, principal: principal(context.principal), text }) ?? false }),
};
const sceneOpen: ExtensionOperationDefinition<InputByName["sceneOpen"], OutputByName["opened"], ExtensionOperationServices> = {
  metadata: metadata("ui.scene.open", "Open a scene", "Ask the host to open one scene included in this package's approved resource scope.", "sceneOpen", output.opened, (value) => value.opened ? "committed" : "conflicted"),
  execute: async ({ sceneId }, context, services) => {
    if (context.host === "terminal" || !context.access.resources.some((resource) => resource.kind === "scene" && resource.id === sceneId) || !services.hostActions) throw new Error("PERMISSION_DENIED: this scene is outside the approved host navigation scope");
    const answer = await services.hostActions.request({ action: "ui.scene.open", operation: "ui.scene.open", packageId: context.principal.packageId, principal: principal(context.principal), sceneId }, context.signal);
    if (answer?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether the scene opened.");
    return { opened: answer?.status === "completed" };
  },
};
const editorOpen: ExtensionOperationDefinition<InputByName["editorOpen"], OutputByName["opened"], ExtensionOperationServices> = {
  metadata: metadata("ui.editor.open", "Open an editor", "Ask the host to open one library item included in this package's approved resource scope.", "editorOpen", output.opened, (value) => value.opened ? "committed" : "conflicted"),
  execute: async ({ kind, id }, context, services) => {
    if (context.host === "terminal" || !context.access.resources.some((resource) => resource.kind === kind && resource.id === id) || !services.hostActions) throw new Error("PERMISSION_DENIED: this item is outside the approved host navigation scope");
    const answer = await services.hostActions.request({ action: "ui.editor.open", operation: "ui.editor.open", packageId: context.principal.packageId, principal: principal(context.principal), kind, entityId: id }, context.signal);
    if (answer?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether the editor opened.");
    return { opened: answer?.status === "completed" };
  },
};

export const uiOperations = [panelSet, panelRemove, notice, dialog, status, sceneOpen, editorOpen] as const;
export const createOperations = (services: ExtensionOperationServices) => uiOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default uiOperations;
