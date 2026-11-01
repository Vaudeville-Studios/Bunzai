/** Strict host-owned iframe relay messages, separate from the guest request/reply wire. */
import { z } from "zod";
import { extensionInvocationSchema } from "../../extensions/contracts/wire";
import { extensionInvocationContextSchema } from "../../extensions/contracts/invocation-context";

export const OPAQUE_WORKER_SOURCE_BYTES = 5_000_000;
export const OPAQUE_WASM_BASE64_BYTES = 1_000_000;
export const opaqueFrameStartSchema = z.strictObject({
  v: z.literal(1), type: z.literal("start"), nonce: z.string().uuid(), source: z.string().max(1_048_576),
  invocation: extensionInvocationSchema, invocationResources: extensionInvocationContextSchema.shape.resources,
  workerSource: z.string().min(1).max(OPAQUE_WORKER_SOURCE_BYTES), wasmBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).max(OPAQUE_WASM_BASE64_BYTES),
});
export const opaqueFrameEnvelopeSchema = z.strictObject({ v: z.literal(1), type: z.string().min(1).max(16), nonce: z.string().uuid() });
