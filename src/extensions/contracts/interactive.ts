/** Versioned host-drawn extension contribution tree; it carries data and declared action IDs only. */
import { z } from "zod";

const text = z.string().max(2_000);
const id = z.string().min(1).max(80);
const node: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text }),
  z.strictObject({ type: z.enum(["stack", "row"]), children: z.array(node).max(32) }),
  z.strictObject({ type: z.literal("field"), id, label: text, value: text.optional(), placeholder: text.optional(), command: id }),
  z.strictObject({ type: z.literal("select"), id, label: text, value: text, options: z.array(z.strictObject({ value: text, label: text })).min(1).max(32), command: id }),
  z.strictObject({ type: z.literal("toggle"), id, label: text, value: z.boolean(), command: id }),
  z.strictObject({ type: z.literal("button"), id, label: text, command: id }),
  z.strictObject({ type: z.literal("list"), items: z.array(node).max(50) }),
  z.strictObject({ type: z.literal("image"), asset: id, alt: text }),
])) as z.ZodType<InteractiveNode>;

export type InteractiveNode =
  | { type: "text"; text: string }
  | { type: "stack" | "row"; children: InteractiveNode[] }
  | { type: "field"; id: string; label: string; value?: string; placeholder?: string; command: string }
  | { type: "select"; id: string; label: string; value: string; options: { value: string; label: string }[]; command: string }
  | { type: "toggle"; id: string; label: string; value: boolean; command: string }
  | { type: "button"; id: string; label: string; command: string }
  | { type: "list"; items: InteractiveNode[] }
  | { type: "image"; asset: string; alt: string };

export const interactiveDescriptorSchema = z.strictObject({ version: z.literal(1), root: node }) as z.ZodType<InteractiveDescriptor>;
export interface InteractiveDescriptor { version: 1; root: InteractiveNode }

/** Bounds the recursive guest tree before Zod traverses it; rejects cycles and exotic objects too. */
export function decodeInteractiveDescriptor(input: unknown): InteractiveDescriptor {
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) throw new Error("interactive descriptor contains a cycle");
    seen.add(value);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error("interactive descriptor contains an exotic object");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) throw new Error("interactive descriptor contains a symbol key");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const children: unknown[] = [];
    for (const key of ownKeys as string[]) {
      const property = descriptors[key];
      if (!property || !("value" in property)) throw new Error("interactive descriptor contains an accessor");
      if (key !== "length") children.push(property.value);
    }
    const isNode = !Array.isArray(value) && "type" in value;
    const nodeDepth = depth + Number(isNode);
    if (isNode && ++count > 200 || nodeDepth > 16) throw new Error("interactive descriptor exceeds its size limit");
    for (const child of children) stack.push({ value: child, depth: nodeDepth });
  }
  return interactiveDescriptorSchema.parse(input);
}

/** Enforces host-owned command and media allowlists before a descriptor is persisted or returned. */
export function validateInteractiveDescriptor(input: unknown, allowed: { commands: readonly string[]; assets: readonly string[] }): InteractiveDescriptor {
  const descriptor = decodeInteractiveDescriptor(input);
  const commands = new Set(allowed.commands), assets = new Set(allowed.assets);
  const stack = [descriptor.root];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.type === "button" || current.type === "field" || current.type === "select" || current.type === "toggle") {
      if (!commands.has(current.command)) throw new Error("interactive descriptor references an undeclared command");
    } else if (current.type === "image") {
      if (!assets.has(current.asset)) throw new Error("interactive descriptor references an unapproved asset");
    } else if (current.type === "row" || current.type === "stack") stack.push(...current.children);
    else if (current.type === "list") stack.push(...current.items);
  }
  return descriptor;
}
