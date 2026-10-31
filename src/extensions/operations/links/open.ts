/** Opens one exact, approved public HTTPS URL only through a host gesture. */
import { z } from "zod";
import { isPublicHttpsOrigin } from "../../contracts/destination";
import { DESKTOP_EXTENSION_HOSTS, bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ url: z.string().min(1).max(2_048) }).superRefine(({ url }, ctx) => {
  try { const parsed = new URL(url); if (parsed.protocol !== "https:" || parsed.username || parsed.password || !isPublicHttpsOrigin(parsed.origin)) throw new Error(); }
  catch { ctx.addIssue({ code: "custom", path: ["url"], message: "Only public HTTPS URLs are supported." }); }
});
const output = z.strictObject({ opened: z.boolean() });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const originOf = (value: string): string[] => { try { const url = new URL(value); return isPublicHttpsOrigin(url.origin) && !url.username && !url.password ? [url.origin] : []; } catch { return []; } };
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "links.open", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Open a link", description: "Open one exact reviewed public HTTPS link after a host gesture.", input, output,
  effect: "external", sensitivity: "private", hosts: DESKTOP_EXTENSION_HOSTS,
  policy: { resources: [], fields: [], methods: [], destinationMode: "approved-public-https", destinations: [], budget: "external", confirmation: "sensitive-send" },
  estimateBudget: () => ({ bytes: 4_096, tokens: 0 }), measureTokens: () => 0,
  receiptStatus: (value) => value.opened ? "committed" : "conflicted",
  resolveAccess: ({ url }) => ({ resources: [], fields: [], methods: [], destinations: originOf(url) }), project: (value) => output.parse(value),
};
const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  review: async ({ url }) => ({ destination: new URL(url).origin, url }),
  execute: async ({ url }, context, services) => {
    const destination = originOf(url)[0];
    if (!destination || context.host !== "desktop" || !services.hostActions || !context.access.destinations.includes(destination)) throw new Error("This link is outside the approved host action scope.");
    const result = await services.hostActions.request({ action: "links.open", operation: "links.open", packageId: context.principal.packageId, principal: {
      storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest, grantRevision: context.principal.grantRevision, runEpoch: context.principal.runEpoch,
    }, url }, context.signal);
    if (result?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether the link was opened.");
    return { opened: result?.status === "completed" };
  },
};
export const linkOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => linkOperations.map((item) => bindExtensionOperation(item, services));
export default linkOperations;
