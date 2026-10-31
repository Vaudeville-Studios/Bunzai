/** Discover trusted extension operation folders and generate the baked runtime and docs. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOperationCatalog } from "../src/extensions/catalog/operations";
import { bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationDescriptor, type HostFeature } from "../src/extensions/contracts/operation";
import { allCapabilities } from "../src/generated/capabilities";
import { STUDIO_ENTITY_KINDS } from "../src/studio/path-policy";

const ROOT = join(import.meta.dir, "..");
const CHECK = process.argv.includes("--check");
if (process.argv.includes("--help")) {
  console.log("Usage: bun run extensions:catalog [--check] [--operations-root <dir>] [--output-root <dir>] [--runtime-out <file>] [--browser-runtime-out <file>] [--metadata-out <file>] [--json-out <file>] [--doc-out <file>] [--coverage-out <file>]");
  process.exit(0);
}
const option = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return resolve(value);
};
if (process.argv.includes("--operations-root") && !process.argv.includes("--output-root")) {
  console.error("extensions:catalog: --output-root is required with a custom --operations-root");
  process.exit(2);
}
const OPERATIONS_ROOT = option("--operations-root", join(ROOT, "src", "extensions", "operations"));
const OUTPUT_ROOT = option("--output-root", ROOT);
const OUTPUT = option("--runtime-out", join(OUTPUT_ROOT, "src", "generated", "extension-operations.ts"));
const BROWSER_OUTPUT = option("--browser-runtime-out", join(OUTPUT_ROOT, "src", "generated", "browser-extension-operations.ts"));
const METADATA_OUTPUT = option("--metadata-out", join(OUTPUT_ROOT, "src", "generated", "extension-operation-metadata.ts"));
const JSON_OUTPUT = option("--json-out", join(OUTPUT_ROOT, "docs", "reference", "extending", "api.json"));
const DOC_OUTPUT = option("--doc-out", join(OUTPUT_ROOT, "docs", "reference", "extending", "api.md"));
const COVERAGE_OUTPUT = option("--coverage-out", join(OUTPUT_ROOT, "docs", "reference", "extending", "coverage.md"));
const toPosix = (path: string): string => path.split("\\").join("/");

function discoverFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.startsWith("_")) files.push(path);
    }
  };
  if (existsSync(root)) visit(root);
  return files.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

async function load(files: readonly string[]): Promise<{ definitions: ExtensionOperationDefinition[]; operations: ExtensionOperationDescriptor[]; browserFiles: string[] }> {
  const definitions: ExtensionOperationDefinition[] = [];
  const browserFiles: string[] = [];
  for (const file of files) {
    const module = await import(pathToFileURL(file).href) as { default?: unknown; definitions?: unknown };
    const exported = module.definitions ?? module.default;
    const moduleDefinitions = (Array.isArray(exported) ? exported : [exported]) as ExtensionOperationDefinition[];
    for (const candidate of moduleDefinitions) {
      if (typeof candidate !== "object" || candidate === null) {
        throw new Error(`invalid operation export in ${toPosix(relative(ROOT, file))}`);
      }
      definitions.push(candidate as ExtensionOperationDefinition);
    }
    if (moduleDefinitions.some((definition) => definition.metadata.hosts.includes("browser"))) browserFiles.push(file);
  }
  const operations = definitions.map((definition) =>
    bindExtensionOperation(definition as ExtensionOperationDefinition<unknown, unknown, unknown>, undefined));
  return { definitions, operations, browserFiles };
}

function modulePath(file: string, output: string): string {
  const path = toPosix(relative(dirname(output), file.replace(/\.ts$/, "")));
  return path.startsWith(".") ? path : `./${path}`;
}

function renderRuntime(files: readonly string[], output: string, factory: string, host?: HostFeature): string {
  const imports = files.map((file, i) => `import * as operationModule${i} from "${modulePath(file, output)}";`);
  const factories = files.map((_, i) => `  ...operationModule${i}.createOperations(services)${host ? `.filter((operation) => operation.hosts.includes(${JSON.stringify(host)}))` : ""},`);
  return `/** Generated extension operation factory seam. Source: operation folders. */
import { createOperationCatalog } from "../extensions/catalog/operations";
import type { ExtensionOperationServices } from "../extensions/operations/_services";
${imports.join("\n")}

export function ${factory}(services: ExtensionOperationServices) {
  return createOperationCatalog([\n${factories.join("\n")}\n  ]);
}
`;
}

function renderDocs(metadata: ReturnType<ReturnType<typeof createOperationCatalog>["metadata"]>): string {
  const lines = metadata.map((item) => {
    const hosts = item.hosts.map((host) => item.hostNotes?.[host] ? `${host}*` : host).join(", ");
    return `| \`${item.id}\` | ${item.title} | ${item.effect} | ${hosts} | ${item.policy.budget} | ${item.policy.confirmation} |`;
  });
  const hostNotes = [...new Set(metadata.flatMap((item) => Object.values(item.hostNotes ?? {})))];
  const note = hostNotes.map((value) => `* ${value}`).join("\n");
  return `# Generated extension API catalog\n\nGenerated from \`src/extensions/operations/\`. Descriptors are the source of truth.\n\nThe table lists host-level adapters. rp-core remains the owner of linked-scene turns, so those turns do not run extension prompt or scene-event hooks and Desktop/Terminal local prompt previews are unavailable for linked scenes.\n\n${note}\n\n| Operation | Name | Effect | Hosts | Budget | Confirmation |\n| --- | --- | --- | --- | --- | --- |\n${lines.join("\n")}\n`;
}

function renderCoverage(metadata: ReturnType<ReturnType<typeof createOperationCatalog>["metadata"]>): string {
  const capabilities = allCapabilities as readonly (typeof allCapabilities[number] & { extensionExposure?: unknown })[];
  const exposed = capabilities.filter((capability) => capability.extensionExposure);
  const adapted = exposed.filter((capability) => typeof capability.extensionExposure === "object" && capability.extensionExposure !== null
    && metadata.some((operation) => operation.id === (capability.extensionExposure as { operationId?: unknown }).operationId));
  const byHost = ["desktop", "browser", "terminal"].map((host) =>
    `| ${host} | ${metadata.filter((operation) => operation.hosts.includes(host as HostFeature)).length} |`,
  );
  const operations = metadata.map((operation) => `| \`${operation.id}\` | ${[...new Set(Object.values(operation.hostNotes ?? {}))].join(" ") || "available"} | ${operation.hosts.join(", ")} |`);
  const bodyRead = metadata.find((item) => item.id === "content.read");
  const groups = STUDIO_ENTITY_KINDS.filter((kind) => bodyRead?.policy.resources.includes(kind))
    .map((kind) => `| ${kind} | \`body\` | available | ${bodyRead!.hosts.join(", ")} |`);
  groups.push(...[
    ["content.fields.read", "character", "character.identity"],
    ["content.links.read", "character", "character.links"],
    ["content.history.read", "character", "character.identity (historical versions)"],
  ].flatMap(([id, kind, group]) => metadata.filter((item) => item.id === id)
    .map((item) => `| ${kind} | \`${group}\` | available | ${item.hosts.join(", ")} |`)));
  groups.push(...metadata.filter((item) => item.id === "content.read" && item.policy.fields.includes("persona.name"))
    .map((item) => `| persona | \`persona.identity\` | available | ${item.hosts.join(", ")} |`));
  const semantic = adapted.map((capability) => {
    const exposure = capability.extensionExposure as { operationId: string };
    return `| \`${capability.id}\` | \`${exposure.operationId}\` | available |`;
  });
  return `# Generated extension coverage\n\nGenerated from source drop-ins. Absence from the operation catalog means unavailable.\n\n## rp-core compatibility\n\nThe operation table lists host-level adapters. Desktop and Terminal cannot create extension scenes because new scenes use rp-core. Per-operation host notes identify legacy-scene-only writes. rp-core-linked turns do not invoke extension prompt or scene-event hooks, so Desktop/Terminal local prompt preview is unavailable for those scenes. Browser/Pocket has no rp-core owner; legacy scenes retain extension behavior. First-party rp-core turns remain available.\n\n## Semantic capability inventory\n\n- Discovered capabilities: ${capabilities.length}\n- Explicitly marked for extension review: ${exposed.length}\n- Semantic capability adapters: ${adapted.length}\n- Strict operation descriptors: ${metadata.length}\n\n| Capability | Operation | Status |\n| --- | --- | --- |\n${semantic.join("\n")}\n\n## Strict content field groups\n\nEach group requires an explicit grant. The full body can include authored prompts and sealed script data; it excludes escrow, notes and platform profiles. Detail groups are narrower.\n\n| Kind | Group | Status | Hosts |\n| --- | --- | --- | --- |\n${groups.join("\n")}\n\n## Host operation inventory\n\n| Operation | Status | Hosts |\n| --- | --- | --- |\n${operations.join("\n")}\n\n## Host totals\n\n| Host | Available operations |\n| --- | ---: |\n${byHost.join("\n")}\n`;
}

const files = discoverFiles(OPERATIONS_ROOT);
const { operations, browserFiles } = await load(files);
const catalog = createOperationCatalog(operations);
const artifacts = new Map([
  [OUTPUT, renderRuntime(files, OUTPUT, "createExtensionOperations")],
  [BROWSER_OUTPUT, renderRuntime(browserFiles, BROWSER_OUTPUT, "createBrowserExtensionOperations", "browser")],
  [METADATA_OUTPUT, `/** Generated host-safe operation metadata. */\nexport const extensionOperationMetadata = [\n${catalog.metadata().map((entry) => `  ${JSON.stringify(entry)},`).join("\n")}\n] as const;\n`],
  [JSON_OUTPUT, `${JSON.stringify(catalog.metadata())}\n`],
  [DOC_OUTPUT, renderDocs(catalog.metadata())],
  [COVERAGE_OUTPUT, renderCoverage(catalog.metadata())],
]);
let stale = false;
for (const [file, body] of artifacts) {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current === body) continue;
  if (CHECK) {
    console.error(`extensions:catalog: stale generated file ${toPosix(relative(ROOT, file))}`);
    stale = true;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body, "utf8");
  }
}
if (stale) process.exit(1);
console.log(`extensions:catalog: ${CHECK ? "checked" : "generated"} ${operations.length} operations from ${files.length} drop-ins`);
