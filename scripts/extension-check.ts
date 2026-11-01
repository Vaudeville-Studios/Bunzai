/** Validate a local extension folder without executing its source code. */
import { resolve } from "node:path";
import { toErrorMessage } from "../src/error-message";
import { decodeExtensionPackageInput } from "../src/extensions/contracts/package-validation";
import { readPackageSource } from "./extension-package-files";
import { extensionOperationMetadata } from "../src/generated/extension-operation-metadata";
import type { HostFeature } from "../src/extensions/contracts/operation";

const args = process.argv.slice(2);
const help = args.includes("--help") || args.length === 0;
if (help) {
  console.log("Usage: bun run extensions:check -- <extension-directory> [--host desktop|browser|terminal] [--json]");
  console.log("Reads manifest.json and declared text assets. Never evaluates package code.");
  process.exit(args.includes("--help") ? 0 : 2);
}

const directoryArg = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--host");
const hostIndex = args.indexOf("--host");
const hostArg = (hostIndex < 0 ? undefined : args[hostIndex + 1]) as HostFeature | undefined;
const json = args.includes("--json");
const fail = (message: string): never => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`extensions:check: ${message}`);
  process.exit(1);
};
if (!directoryArg) fail("provide a package directory");
if (args.includes("--host") && !["desktop", "browser", "terminal"].includes(hostArg ?? "")) {
  fail("--host must be desktop, browser, or terminal");
}
const directory = resolve(directoryArg);
let source: ReturnType<typeof readPackageSource>;
try { source = readPackageSource(directory); }
catch (error) { fail(toErrorMessage(error, "unable to read package source")); }
const { manifest, files, licenseText } = source;
if (manifest.api.major !== 1 || manifest.api.minMinor > 0 || manifest.api.maxMinor < 0) {
  fail("manifest targets an incompatible extension API version");
}
let inspected: Awaited<ReturnType<typeof decodeExtensionPackageInput>>;
try { inspected = await decodeExtensionPackageInput({ manifest, files, ...(licenseText ? { licenseText } : {}) }); }
catch (error) { fail(toErrorMessage(error, "invalid extension package")); }
const known = new Map(extensionOperationMetadata.map((operation) => [operation.id, operation]));
for (const requirement of manifest.requirements) {
  const operation = known.get(requirement.operation);
  if (!operation) fail(`unknown or unavailable operation "${requirement.operation}"`);
  if (hostArg && !operation.hosts.includes(hostArg)) {
    fail(`operation "${operation.id}" is unavailable on ${hostArg}`);
  }
  if (requirement.resources.some((resource) => !operation.policy.resources.includes(resource))) {
    fail(`operation "${operation.id}" does not declare a requested resource`);
  }
}
for (const contribution of manifest.contributions) {
  if (contribution.type === "command"
    && !manifest.requirements.some((requirement) => requirement.operation === contribution.operation)) {
    fail(`command "${contribution.id}" refers to an undeclared operation`);
  }
}
const result = { ok: true, id: manifest.id, version: manifest.version, operations: manifest.requirements.map((r) => r.operation) };
const digest = inspected.digest;
if (json) console.log(JSON.stringify({ ...result, digest }));
else console.log(`extensions:check: ${result.id}@${result.version} is valid (${result.operations.length} operation requirements)`);
