/** Generate the guest SDK types and wrappers from the extension operation catalog. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CATALOG = join(ROOT, "docs", "reference", "extending", "api.json");
const OUTPUT = join(ROOT, "src", "extensions", "sdk", "index.ts");
const DOC_OUTPUT = join(ROOT, "docs", "reference", "extending", "sdk.md");
const CHECK = process.argv.includes("--check");
type Schema = Record<string, unknown>;
interface Operation { id: string; input: Schema; output: Schema }
function methodName(id: string): string {
  const [first, ...rest] = id.split(/[.-]/);
  return first!.toLowerCase() + rest.map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function typeOf(schema: Schema, root: Schema, optional = false): string {
  if (typeof schema.$ref === "string") return "JsonValue";
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map((item) => typeOf(item as Schema, root)).join(" | ");
  if (schema.type === "array") return `(${typeOf(schema.items as Schema, root)})[]`;
  if (schema.type === "object") {
    const props = schema.properties as Record<string, Schema> | undefined;
    if (props) {
      const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : []);
      return `{ ${Object.entries(props).map(([key, value]) =>
        `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${typeOf(value, root)}`,
      ).join("; ")} }`;
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      return `{ [key: string]: ${typeOf(schema.additionalProperties as Schema, root)} }`;
    }
    return "Record<string, JsonValue>";
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  return "JsonValue";
}

function render(operations: readonly Operation[]): string {
  const defs = (operations.flatMap((operation) => [operation.input, operation.output])
    .find((schema) => schema.$defs) as Schema | undefined)?.$defs as Record<string, Schema> | undefined;
  const aliases = Object.entries(defs ?? {}).map(([name, schema]) =>
    `export type ${name} = ${typeOf(schema, schema)};`,
  );
  const inputs = operations.map((operation) =>
    `  ${JSON.stringify(operation.id)}: ${typeOf(operation.input, operation.input)};`,
  );
  const outputs = operations.map((operation) =>
    `  ${JSON.stringify(operation.id)}: ${typeOf(operation.output, operation.output)};`,
  );
  const names = operations.map(({ id }) => methodName(id));
  if (new Set(names).size !== names.length) throw new Error("operation IDs collide in generated SDK method names");
  const wrappers = operations.map((operation, index) =>
    `    ${names[index]}(args: ExtensionOperationInputs[${JSON.stringify(operation.id)}]): Promise<ExtensionOperationOutputs[${JSON.stringify(operation.id)}]> { return bunzai.call(${JSON.stringify(operation.id)}, args); },`,
  );
  const ids = operations.map(({ id }) => JSON.stringify(id)).join(" | ") || "never";
  return `/** Generated guest SDK. Run \`bun run extensions:sdk\` to update. */
import type { JsonValue } from "../contracts/value";
import type { ExtensionError, ExtensionErrorCode } from "../contracts/errors";
export type { ExtensionError, ExtensionErrorCode } from "../contracts/errors";

export class ExtensionCallError extends Error {
  readonly code: ExtensionErrorCode;
  constructor(error: ExtensionError) {
    super(error.message);
    this.name = "ExtensionCallError";
    this.code = error.code;
  }
}

${aliases.join("\n")}
export type ExtensionOperationId = ${ids};
export interface ExtensionOperationInputs {\n${inputs.join("\n")}\n}
export interface ExtensionOperationOutputs {\n${outputs.join("\n")}\n}

type HandlerResult = JsonValue | void | Promise<JsonValue | void>;
export interface ExtensionDefinition {
  commands?: Readonly<Record<string, (input: JsonValue) => HandlerResult>>;
  events?: Readonly<Record<string, (input: JsonValue) => HandlerResult>>;
}
export interface ExtensionInvocationResource { readonly kind: string; readonly id: string }
export interface ExtensionInvocationContext { readonly resources: readonly ExtensionInvocationResource[] }
interface GuestBridge {
  call(operation: string, args: JsonValue): Promise<JsonValue>;
  extension: { define(definition: ExtensionDefinition): void };
  readonly context: Readonly<{ invocation: ExtensionInvocationContext }>;
}
declare global { var bunzai: GuestBridge | undefined }

function bridge(): GuestBridge {
  if (!globalThis.bunzai || typeof globalThis.bunzai.call !== "function") {
    throw new Error("Bunzai extension call bridge is unavailable in this host.");
  }
  return globalThis.bunzai;
}

/** Every method dispatches through the same broker bridge used by low-level calls. */
export const bunzai = {
  call<Id extends ExtensionOperationId>(operation: Id, args: ExtensionOperationInputs[Id]): Promise<ExtensionOperationOutputs[Id]> {
    return bridge().call(operation, args as JsonValue) as Promise<ExtensionOperationOutputs[Id]>;
  },
  operations: {\n${wrappers.join("\n")}\n  },
  extension: {
    define(definition: ExtensionDefinition): void {
      bridge().extension.define(definition);
    },
  },
  get context(): GuestBridge["context"] { return bridge().context; },
};
`;
}

function renderDocs(operations: readonly Operation[]): string {
  const rows = operations.map((operation) =>
    `| \`${methodName(operation.id)}\` | \`${operation.id}\` | [schema](api.json#${operation.id}) |`,
  );
  return `# Generated guest SDK\n\nGenerated from the operation catalog. Each convenience method calls the same \`bunzai.call\` bridge and is subject to the same authorization.\n\n## Host invocation context\n\n\`bunzai.context.invocation.resources\` is a read-only array of at most 16 host-selected \`{kind,id}\` refs. The host supplies it separately from command input; it does not grant access. Each operation still requires an exact matching grant. Desktop and Browser command menus attach staged or active pieces. Terminal has no current-piece selector; use explicit operation resource selectors where supported.\n\n| SDK method | Operation | Contract |\n| --- | --- | --- |\n${rows.join("\n")}\n`;
}

const operations = JSON.parse(readFileSync(CATALOG, "utf8")) as Operation[];
const body = render(operations);
const artifacts = new Map([[OUTPUT, body], [DOC_OUTPUT, renderDocs(operations)]]);
let stale = false;
for (const [file, content] of artifacts) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (content === current) continue;
  if (CHECK) {
    console.error(`extensions:sdk: stale generated file ${relative(ROOT, file)}`);
    stale = true;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
}
if (stale) process.exit(1);
console.log(`extensions:sdk: ${CHECK ? "checked" : "generated"} ${operations.length} operation wrappers`);
