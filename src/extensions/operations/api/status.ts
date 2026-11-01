/** Host and principal status operations use only trusted broker context projections. */
import { z } from "zod";
import { bindExtensionOperation, defineExtensionOperationMetadata, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { operationPageSchema, pageAvailableOperations, projectAvailableOperations } from "../../contracts/operation-metadata";
import { extensionGrantSchema, effectReceiptSchema } from "../../contracts/grants";
import { decodeJsonValue, MAX_VALUE_BYTES } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { operationIdSchema } from "../../contracts/operation-id";
import { isRecord } from "../../../core/guards";

const empty = z.strictObject({});
const pageInput = z.object({ offset: z.number().int().min(0).max(2000).default(0), limit: z.number().int().min(1).max(20).default(10) }).strict();
const searchInput = pageInput.extend({ query: z.string().trim().min(1).max(120) }).strict();
const hostInput = pageInput;
const operationId = operationIdSchema;
const statusInput = z.strictObject({ operations: z.array(operationId).max(100).optional() });
const receiptsInput = z.strictObject({ offset: z.number().int().min(0).max(19).default(0), limit: z.number().int().min(1).max(20).default(20) });
const hostOutput = z.strictObject({ host: z.enum(["desktop", "browser", "terminal"]), ...operationPageSchema.shape });
const permissionsOutput = z.strictObject({ packageId: z.string().min(1).max(120), grants: z.array(extensionGrantSchema).max(256) });
const statusOutput = z.strictObject({ host: z.enum(["desktop", "browser", "terminal"]), operations: z.array(z.strictObject({ id: operationId, status: z.enum(["available", "unavailable"]), granted: z.boolean() })).max(100) });
const receiptsOutput = z.strictObject({ receipts: z.array(effectReceiptSchema).max(20), truncated: z.boolean() });
function metadata<I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>): ExtensionOperationMetadata<I, O> {
  /* clone-ok: host-neutral public metadata reads use a different trust and effect policy than clipboard operations. */
  return defineExtensionOperationMetadata({ id, title, description, input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
    policy: { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none", budget: "metadata", confirmation: "none" },
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value) });
}
const operation = <I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, execute: ExtensionOperationDefinition<I, O, ExtensionOperationServices>["execute"]): ExtensionOperationDefinition<I, O, ExtensionOperationServices> => ({ metadata: metadata(id, title, description, input, output), execute });

const hostFeatures = operation("host.features", "Host availability", "Page public operations available from this concrete host and this package's grant status.", hostInput, hostOutput,
  async ({ offset, limit }, context) => ({ host: context.host, ...pageAvailableOperations(projectAvailableOperations(context.availableOperations, context.host, context.grantedOperations), offset, limit) }));
const apiSearch = operation("api.search", "Search the operation catalog", "Search public host-available operation metadata by name, summary or ID.", searchInput, operationMetadataOutput(),
  async ({ query, offset, limit }, context) => {
    const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const rows = projectAvailableOperations(context.availableOperations, context.host, context.grantedOperations);
    return pageAvailableOperations(rows.filter((row) => terms.every((term) => `${row.id} ${row.title} ${row.description}`.toLocaleLowerCase().includes(term))), offset, limit);
  });
function operationMetadataOutput() { return operationPageSchema; }
const permissionsStatus = operation("permissions.status", "Current permissions", "List only this package's current validated grants.", empty, permissionsOutput,
  async (_args, context) => ({ packageId: context.principal.packageId, grants: permissionsOutput.shape.grants.parse(context.availableGrants) }));
const operationsStatus = operation("operations.status", "Operation availability", "Report host availability and this package's grant status for selected operation IDs.", statusInput, statusOutput,
  async ({ operations }, context) => {
    const available = new Set(context.availableOperations.map((item) => isRecord(item) ? String(item.id) : ""));
    const ids = operations ?? [...new Set([...available, ...context.grantedOperations])].slice(0, 100);
    return { host: context.host, operations: ids.map((id) => ({ id, status: available.has(id) ? "available" as const : "unavailable" as const, granted: context.grantedOperations.includes(id) })) };
  });
const receiptList = operation("operations.receipts.list", "List own effect receipts", "List bounded, redacted receipts belonging only to this package.", receiptsInput, receiptsOutput,
  async ({ offset, limit }, context) => {
    const receipts = receiptsOutput.shape.receipts.parse(context.operationReceipts);
    return { receipts: receipts.slice(offset, offset + limit), truncated: offset + limit < receipts.length };
  });

export const apiStatusOperations = [apiSearch, hostFeatures, permissionsStatus, operationsStatus, receiptList] as const;
export const createOperations = (services: ExtensionOperationServices) => apiStatusOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default apiStatusOperations;
