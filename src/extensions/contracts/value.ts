/** JSON values admitted across the guest boundary. */
import { z } from "zod";
import { MAX_EXTENSION_PACKAGE_BYTES, MAX_KEY_CHARS, MAX_VALUE_BYTES, MAX_VALUE_DEPTH, MAX_VALUE_ITEMS } from "./limits";
import { canonicalJsonString, sha256HexBytes } from "../../core/sha256";
export { MAX_EXTENSION_PACKAGE_BYTES, MAX_KEY_CHARS, MAX_VALUE_BYTES, MAX_VALUE_DEPTH, MAX_VALUE_ITEMS } from "./limits";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** JSON Schema's recursive object branch is intentionally open only for JSON payload values. */
export const operationJsonValueSchema = z.json().meta({ extensionJsonValue: true }) as z.ZodType<JsonValue>;

const INVALID = Symbol("invalid-json-value");
function boundedJsonCloneUnchecked(value: unknown, maxBytes = MAX_VALUE_BYTES): JsonValue | typeof INVALID {
  const allocate = (item: unknown): JsonValue | null => item === null || typeof item === "boolean" || typeof item === "string" || typeof item === "number" ? item : Array.isArray(item) ? [] : typeof item === "object" ? Object.create(null) as Record<string, JsonValue> : null;
  const root = allocate(value);
  if (root === null && value !== null) return INVALID;
  const stack: { source: unknown; target: JsonValue; depth: number; leave?: object }[] = [{ source: value, target: root!, depth: 0 }];
  const active = new WeakSet<object>();
  let items = 0;
  let keysTotal = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.leave) { active.delete(item.leave); continue; }
    if (++items > MAX_VALUE_ITEMS || item.depth > MAX_VALUE_DEPTH) return INVALID;
    const current = item.source;
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "number") { if (!Number.isFinite(current)) return INVALID; continue; }
    if (typeof current === "string") { if (current.length > maxBytes) return INVALID; continue; }
    if (typeof current !== "object") return INVALID;
    const object = current as object;
    if (active.has(object)) return INVALID;
    active.add(object);
    stack.push({ source: null, target: null, depth: item.depth, leave: object });
    if (Array.isArray(current)) {
      if (current.length > MAX_VALUE_ITEMS || Reflect.ownKeys(current).length !== current.length + 1 || !Array.isArray(item.target)) return INVALID;
      for (let i = current.length - 1; i >= 0; i--) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return INVALID;
        const child = allocate(descriptor.value);
        if (child === null && descriptor.value !== null) return INVALID;
        item.target[i] = child as JsonValue;
        stack.push({ source: descriptor.value, target: child as JsonValue, depth: item.depth + 1 });
      }
    } else {
      const proto = Object.getPrototypeOf(current);
      const ownKeys = Reflect.ownKeys(current);
      if ((proto !== Object.prototype && proto !== null) || ownKeys.length > MAX_VALUE_ITEMS) return INVALID;
      keysTotal += ownKeys.length;
      if (keysTotal > MAX_VALUE_ITEMS || typeof item.target !== "object" || item.target === null || Array.isArray(item.target)) return INVALID;
      for (const key of ownKeys) {
        if (typeof key !== "string" || key.length > MAX_KEY_CHARS || key === "__proto__" || key === "prototype" || key === "constructor") return INVALID;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return INVALID;
        const child = allocate(descriptor.value);
        if (child === null && descriptor.value !== null) return INVALID;
        (item.target as { [key: string]: JsonValue })[key] = child as JsonValue;
        stack.push({ source: descriptor.value, target: child as JsonValue, depth: item.depth + 1 });
      }
    }
  }
  try { return new TextEncoder().encode(JSON.stringify(root)).byteLength <= maxBytes ? root! : INVALID; }
  catch { return INVALID; }
}

function boundedJsonClone(value: unknown, maxBytes = MAX_VALUE_BYTES): JsonValue | typeof INVALID {
  try { return boundedJsonCloneUnchecked(value, maxBytes); }
  catch { return INVALID; }
}

const jsonValueSchemaBounded = z.preprocess((value, context) => {
  const clone = boundedJsonClone(value);
  if (clone === INVALID) { context.addIssue({ code: "custom", message: "invalid bounded JSON value" }); return z.NEVER; }
  return clone;
}, z.json()) as z.ZodType<JsonValue>;
export { jsonValueSchemaBounded };
/** Parses host-independent data and enforces aggregate depth and byte bounds. */
export function decodeJsonValue(value: unknown): JsonValue {
  const clone = boundedJsonClone(value);
  if (clone === INVALID) throw new Error("invalid bounded JSON value");
  return clone;
}

/** One canonical package/policy serialization; unbounded and non-JSON values are rejected first. */
export function canonicalJson(value: unknown, maxBytes = MAX_VALUE_BYTES): string {
  const clone = boundedJsonClone(value, maxBytes);
  if (clone === INVALID) throw new Error("invalid bounded JSON value");
  return canonicalJsonString(clone);
}

export const canonicalJsonBytes = (value: unknown, maxBytes = MAX_VALUE_BYTES): Uint8Array<ArrayBuffer> => new TextEncoder().encode(canonicalJson(value, maxBytes));
export async function digestJson(value: unknown, maxBytes = MAX_VALUE_BYTES): Promise<string> {
  return sha256HexBytes(canonicalJsonBytes(value, maxBytes));
}
