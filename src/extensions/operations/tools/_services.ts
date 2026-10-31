/** Purpose: define the narrow port for reviewed, read-only Kit discovery tools. */
import type { JsonValue } from "../../contracts/value";

export interface ExtensionKitToolMetadata {
  id: string;
  description: string;
  inputSchema: string;
}
export interface ExtensionKitToolServices {
  list(): readonly ExtensionKitToolMetadata[];
  describe(id: string): ExtensionKitToolMetadata | null;
  invoke(id: string, args: JsonValue, signal: AbortSignal, assertCurrent: () => Promise<void>): Promise<{ summary: string; output: string }>;
}
