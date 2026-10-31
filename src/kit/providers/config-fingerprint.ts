/** Host-only fingerprint of the exact saved provider configuration and selected model. */
import { canonicalJsonString, sha256HexBytes } from "../../core/sha256";
import type { ProviderConfig } from "./config";

export function providerConfigFingerprint(config: ProviderConfig, model: string = config.model): string {
  return sha256HexBytes(new TextEncoder().encode(canonicalJsonString({ ...config, model })));
}
