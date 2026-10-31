/** Purpose: prove close blocks every package while one begun file effect settles. */
import { expect, test } from "bun:test";
import { z } from "zod";
import type { ExtensionOperationDescriptor } from "../contracts/operation";
import type { PendingExtensionFileAction } from "../contracts/file-actions";
import { EXTENSION_BUDGET_PRESETS } from "../contracts/operation";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { createExtensionConfirmations } from "./confirmation";
import type { HostFileActionPort } from "./file-action-port";
import { createExtensionService } from "./service";

const packageFor = (id: string, operation: string) => ({ manifest: {
  schemaVersion: 1 as const, id, version: "1.0.0", name: id, description: "fixture", author: "test",
  api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js",
  requirements: [{ operation, resources: [], fields: operation === "files.write.apply" ? ["file.contents"] : [], methods: [], destinations: [], purpose: "fixture", required: true }],
  contributions: [{ type: "command" as const, id: "run", label: "Run", operation }],
}, files: { "main.js": operation === "files.write.apply"
  ? `bunzai.extension.define({commands:{run:async()=>{try{await bunzai.call("files.write.apply",{previewId:"p"})}catch{}await new Promise(()=>{})}}});`
  : `bunzai.extension.define({commands:{run:()=>bunzai.call("test.ping",{})}});` } });

test("close blocks a second package while the first package's begun write receipt settles", async () => {
  const store = memoryExtensionStore(() => 1), confirmations = createExtensionConfirmations({ now: () => 1, id: () => "effect-close" });
  let ticket: PendingExtensionFileAction | null = null;
  let finishWrite!: (status: "written" | "ambiguous" | "cancelled") => void;
  let releaseConfirmation!: () => void, confirmationStarted!: () => void;
  const answerStarted = new Promise<void>((resolve) => { confirmationStarted = resolve; });
  let started = false, fileAnswers = 0, effectAnswers = 0;
  const fileActions = {
    pending: () => ticket ? [ticket] : [],
    stageWrite: ({ packageName, principal }: { packageName: string; principal: import("../contracts/operation").OperationPrincipal; previewId: string; signal: AbortSignal }) => {
      ticket = { id: "file-close", packageId: principal.packageId, packageName,
        principal: { storeId: principal.storeId, packageId: principal.packageId, packageDigest: principal.packageDigest, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch },
        operation: "files.write.apply", action: "write", handleId: "opaque", fileName: "out.txt", mode: "create",
        current: { size: 0, lastModified: 1, digest: "b".repeat(64) }, proposedBytes: 1, proposedDigest: "c".repeat(64), expiresAt: 100_000 };
      return ticket;
    },
    beginWrite: (id: string) => { if (ticket?.id !== id) return false; started = true; return true; },
    startedWritesForPackage: (id: string) => started && ticket?.packageId === id ? [ticket.id] : [],
    setStartedWriteExpiryHandler: () => undefined,
    write: (_request: { packageName: string; principal: import("../contracts/operation").OperationPrincipal; previewId: string; signal: AbortSignal }) => new Promise<"written" | "ambiguous" | "cancelled">((resolve) => { finishWrite = resolve; }),
    answer: (id: string, value: unknown) => {
      fileAnswers++;
      if (ticket?.id !== id) return false;
      finishWrite?.((value as { status: "written" | "ambiguous" | "cancelled" }).status);
      return true;
    },
    invalidatePackage: () => 0,
    close: () => undefined,
  } as unknown as HostFileActionPort;
  const write: ExtensionOperationDescriptor<{ previewId: string }, { written: boolean }> = {
    id: "files.write.apply", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Write", description: "fixture",
    input: z.strictObject({ previewId: z.string() }), output: z.strictObject({ written: z.boolean() }), effect: "write", sensitivity: "private", hosts: ["desktop"],
    policy: { resources: [], fields: ["file.contents"], methods: [], destinations: [], destinationMode: "none", budget: "write", confirmation: "effect" },
    estimateBudget: () => ({ bytes: 100, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: ["file.contents"], methods: [], destinations: [] }), project: (value) => value,
    review: async (_args, context) => ({ hostAction: { kind: "bunzai.file.write", ticketId: fileActions.stageWrite({ packageName: context.principal.packageId, principal: context.principal, previewId: "p", signal: context.signal }).id } }),
    execute: async (_args, context) => {
      const status = await fileActions.write({ packageName: context.principal.packageId, principal: context.principal, previewId: "p", signal: context.signal });
      if (status !== "written") throw new Error("uncertain write"); return { written: true };
    },
  };
  let secondCalls = 0;
  const ping: ExtensionOperationDescriptor<Record<string, never>, { ok: boolean }> = {
    id: "test.ping", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Ping", description: "fixture",
    input: z.strictObject({}), output: z.strictObject({ ok: z.boolean() }), effect: "read", sensitivity: "public", hosts: ["desktop"],
    policy: { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none", budget: "read-small", confirmation: "none" },
    estimateBudget: () => ({ bytes: 1, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }), project: (value) => value,
    execute: async () => { secondCalls++; return { ok: true }; },
  };
  let serial = 0;
  const service = createExtensionService({ store, storeId: "close-admission", host: "desktop", operations: [write, ping], fileActions,
    now: () => 1, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    confirmEffect: (packageId, packageName, effect, signal) => confirmations.request(packageId, packageName, effect, signal),
    pendingEffects: () => confirmations.list(),
    answerEffect: async (id, approved) => {
      effectAnswers++;
      if (approved) { confirmationStarted(); await new Promise<void>((resolve) => { releaseConfirmation = resolve; }); }
      return confirmations.answer(id, approved);
    },
  });
  await service.start();
  try {
    const install = async (id: string, operation: string, budget: keyof typeof EXTENSION_BUDGET_PRESETS) => {
      const review = await service.preview(packageFor(id, operation));
      return await service.install(review.challenge, [{ operation, resources: [], fields: operation === "files.write.apply" ? ["file.contents"] : [], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS[budget] }], [], review.expectedRevision);
    };
    const first = await install("fixture.first", "files.write.apply", "write");
    const firstEnabled = await service.enable(first.id, first.revision);
    const second = await install("fixture.second", "test.ping", "read-small");
    await service.enable(second.id, second.revision);
    const run = service.activate(first.id, "command", "run", null).catch(() => null);
    for (let index = 0; index < 100 && !fileActions.pending().length; index++) await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = fileActions.pending()[0];
    expect(pending?.action).toBe("write");
    expect(await service.pendingEffects()).toMatchObject([expect.objectContaining({ review: expect.objectContaining({ hostAction: expect.objectContaining({ ticketId: pending?.id }) }) })]);
    expect(await service.beginFileWrite(pending!.id)).toBe(true);
    const closing = service.close();
    await Promise.race([answerStarted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`write settlement did not reach host confirmation: file=${fileAnswers}, effect=${effectAnswers}, pending=${fileActions.pending().length}`)), 1_000))]);
    await expect(service.activate(second.id, "command", "run", null)).rejects.toThrow();
    expect(secondCalls).toBe(0);
    releaseConfirmation();
    await closing;
    await run;
    expect((await store.listReceipts(first.id, null, 5)).map(({ status }) => status)).toEqual(["ambiguous"]);
    expect(firstEnabled.enabled).toBe(true);
  } finally { releaseConfirmation?.(); await service.close(); }
});
