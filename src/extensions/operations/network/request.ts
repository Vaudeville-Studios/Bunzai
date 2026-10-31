/** Bounded HTTPS requests to exact, host-reviewed public origins. */
import { z } from "zod";
import { digestJson, jsonValueSchemaBounded } from "../../contracts/value";
import { isPublicHttpsOrigin } from "../../contracts/destination";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { VETTED_METHODS, type VettedMethod } from "../../../kit/providers/egress";
import type { ExtensionOperationServices } from "../_services";

const MAX_REQUEST_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 262_144;
const input = z.strictObject({ url: z.string().min(1).max(2048), method: z.enum(VETTED_METHODS), body: jsonValueSchemaBounded.optional() }).superRefine(({ method, body }, ctx) => {
  if (method === "GET" && body !== undefined) ctx.addIssue({ code: "custom", path: ["body"], message: "GET requests cannot include a body" });
  if (body !== undefined && new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_REQUEST_BYTES) ctx.addIssue({ code: "custom", path: ["body"], message: "request body exceeds 32 KiB" });
});
const output = z.strictObject({ status: z.number().int().min(100).max(599), contentType: z.string().max(200).nullable(), body: z.string().max(MAX_RESPONSE_BYTES) });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const origins = (urlText: string): string[] => {
  let url: URL;
  try { url = new URL(urlText); } catch { return []; }
  return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && isPublicHttpsOrigin(url.origin) ? [url.origin] : [];
};
const encoded = (body: Input["body"]): Uint8Array | undefined => body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body));

const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "network.request", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Send an HTTPS request", description: "Send one bounded request to an exact approved public HTTPS origin.",
  input, output, effect: "external", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [], fields: [], methods: [...VETTED_METHODS], destinationMode: "approved-public-https", destinations: [], budget: "external", confirmation: "sensitive-send" },
  estimateBudget: ({ body }) => ({ bytes: MAX_RESPONSE_BYTES + (encoded(body)?.byteLength ?? 0), tokens: 0 }),
  measureTokens: () => 0,
  resolveAccess: ({ url, method }) => ({ resources: [], fields: [], methods: [method], destinations: origins(url) }),
  project: (value) => value,
};

const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  review: async ({ url, method, body }) => {
    const destination = origins(url)[0];
    if (!destination) throw new Error("Only public HTTPS destinations are available.");
    const bytes = encoded(body);
    if (bytes && bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("The request body exceeds 32 KiB.");
    return { method, destination, path: new URL(url).pathname, requestBytes: bytes?.byteLength ?? 0, requestDigest: body === undefined ? null : await digestJson(body), body: body ?? null, maximumResponseBytes: MAX_RESPONSE_BYTES };
  },
  execute: async ({ url, method, body }, context, services) => {
    if (context.host === "browser") throw new Error("Network requests are unavailable in Browser Studio.");
    const destination = origins(url)[0];
    if (!destination || context.access.methods.length !== 1 || context.access.methods[0] !== method || !context.access.destinations.includes(destination)) throw new Error("This exact method and destination are not approved.");
    const bytes = encoded(body);
    if (bytes && bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("The request body exceeds 32 KiB.");
    const network = services.network;
    if (!network) throw new Error("Network requests are unavailable on this host.");
    await context.assertCurrent();
    return output.parse(await network.request(url, method as VettedMethod, bytes, MAX_RESPONSE_BYTES, context.signal, context.access.destinations, context.assertCurrent));
  },
};

export const networkOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => networkOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default networkOperations;
