/** Release ceilings for one JavaScript guest; worker memory also includes WASM overhead. */
export const RELEASE_JS_LIMITS = {
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  wasmMemoryBytes: 128 * 1024 * 1024,
  cpuMs: 2_000,
  activeMs: 10_000,
  absoluteMs: 300_000,
  sourceBytes: 1 * 1024 * 1024,
  maxPending: 32,
  maxPumpJobs: 100,
  maxLogBytes: 2_048,
} as const;

export type JavaScriptLimits = typeof RELEASE_JS_LIMITS;

/** UTF-8 source cap checked before creating an interpreter. */
export function assertJavaScriptSource(source: string): void {
  const bytes = new TextEncoder().encode(source).byteLength;
  if (bytes > RELEASE_JS_LIMITS.sourceBytes) throw new RangeError(`source-size: ${bytes} exceeds ${RELEASE_JS_LIMITS.sourceBytes}`);
}
