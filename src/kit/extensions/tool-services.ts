/** Purpose: adapt only Kit's reviewed public docs and semantic discovery tools to Extensions. */
import type { JsonValue } from "../../extensions/contracts/value";
import type { ExtensionKitToolMetadata, ExtensionKitToolServices } from "../../extensions/operations/tools/_services";
import { allCapabilities } from "../../generated/capabilities";
import { createChangeSession } from "../changes/session";
import { createCapabilityRuntime } from "../capabilities/runtime";
import { createBunzaiDocs } from "../docs/repository";
import { createCapabilityFindTool } from "../tools/capability-find";
import { discoverTools } from "../tools/discover";
import type { ExtensionToolContext, HarnessTool } from "../tools/tool";
import { z } from "zod";

const MAX_RESULT_BYTES = 32_000;

export async function createExtensionKitTools(host: "desktop" | "terminal", docs = createBunzaiDocs()): Promise<ExtensionKitToolServices> {
  const capabilities = createCapabilityRuntime({ capabilities: allCapabilities, directTools: [], changes: createChangeSession() });
  const candidates: HarnessTool[] = [...await discoverTools(), createCapabilityFindTool(capabilities)];
  const tools = candidates.flatMap((tool) => {
    const exposure = tool.extensionExposure, execute = tool.executeExtension;
    if (!exposure?.hosts.includes(host) || exposure.resourceKind !== "kit-tool" || exposure.sensitivity !== "public" || !execute || tool.effect !== "read") return [];
    const inputSchema = JSON.stringify(z.toJSONSchema(tool.input, { unrepresentable: "throw" }));
    if (new TextEncoder().encode(inputSchema).byteLength > MAX_RESULT_BYTES) throw new Error(`Kit tool schema is too large: ${tool.name}`);
    return [{ id: tool.name, description: tool.description, inputSchema,
      async invoke(args: JsonValue, signal: AbortSignal, assertCurrent: () => Promise<void>) {
        signal.throwIfAborted();
        await assertCurrent();
        const result = await execute(tool.input.parse(args), { docs } satisfies ExtensionToolContext);
        signal.throwIfAborted();
        const encoder = new TextEncoder(), decoder = new TextDecoder();
        const summaryBytes = encoder.encode(result.summary).slice(0, 500), summary = decoder.decode(summaryBytes);
        const output = decoder.decode(encoder.encode(result.output).slice(0, MAX_RESULT_BYTES - summaryBytes.byteLength - 64));
        if (encoder.encode(JSON.stringify({ summary, output })).byteLength > MAX_RESULT_BYTES) throw new Error("Kit tool result exceeds the 32 KB limit.");
        return { summary, output };
      } }];
  });
  if (tools.length > 64) throw new Error("The reviewed Kit tool catalog exceeds its 64-tool limit.");
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  return {
    list: () => tools.map(({ id, description, inputSchema }) => ({ id, description, inputSchema })),
    describe: (id) => { const item = byId.get(id); return item ? { id: item.id, description: item.description, inputSchema: item.inputSchema } : null; },
    async invoke(id, args, signal, assertCurrent) { const tool = byId.get(id); if (!tool) throw new Error("Kit tool is not in the reviewed read-only allowlist."); return tool.invoke(args, signal, assertCurrent); },
  };
}
