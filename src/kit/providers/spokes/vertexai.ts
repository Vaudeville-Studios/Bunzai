/**
 * Vertex AI (Google Cloud): the key is a Service Account JSON, exchanged for a short-lived token at Google, then Vertex's
 * OpenAI-compatible endpoint on the global location. The token address is fixed here, never read from the pasted JSON, so a
 * crafted file cannot send a signed request anywhere else.
 */
import { createSign } from "node:crypto";
import type { ProviderSpoke } from "../spoke";
import { guardedFetch } from "../egress";
import { createOpenAICompatibleProvider } from "../../../stage/provider/openai-compatible";

const HOST = "aiplatform.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** A token is renewed this long before Google says it expires, so a reply never starts on one about to lapse. */
const RENEW_EARLY_MS = 60_000;

interface ServiceAccount { client_email: string; private_key: string; project_id: string }

export function readServiceAccount(raw: string | undefined): ServiceAccount {
  let parsed: unknown;
  try { parsed = JSON.parse(raw ?? ""); } catch { throw new Error("Vertex AI needs the Service Account JSON pasted as the key."); }
  const account = parsed as Partial<ServiceAccount> | null;
  if (typeof account?.client_email !== "string" || typeof account.private_key !== "string" || typeof account.project_id !== "string") {
    throw new Error("That Service Account JSON has no client_email, private_key or project_id.");
  }
  if (!/^[a-z0-9-]+$/.test(account.project_id)) throw new Error("That Service Account JSON has an unusable project_id.");
  return account as ServiceAccount;
}

export function signedAssertion(account: ServiceAccount, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 })}`;
  return `${input}.${createSign("RSA-SHA256").update(input).sign(account.private_key).toString("base64url")}`;
}

const tokens = new Map<string, { token: string; until: number }>();

async function accessToken(account: ServiceAccount, fetchImpl: typeof fetch): Promise<string> {
  const held = tokens.get(account.client_email);
  if (held && held.until > Date.now() + RENEW_EARLY_MS) return held.token;
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(account, Math.floor(Date.now() / 1000)) }),
  });
  if (!response.ok) throw new Error(`Google refused that Service Account (${response.status}).`);
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google sent no access token for that Service Account.");
  tokens.set(account.client_email, { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

const vertexai: ProviderSpoke = {
  id: "vertexai",
  group: "Enterprise",
  label: "Vertex AI (Google Cloud)",
  brand: "#4285F4",
  host: HOST,
  keyHint: "paste your Service Account JSON",
  defaultModel: "google/gemini-2.5-pro",
  scene: {
    base: () => `https://${HOST}/v1`,
    async resolve(config, fetch, label) {
      const account = readServiceAccount(config.apiKey);
      const token = await accessToken(account, guardedFetch(new URL(TOKEN_URL).host) as typeof globalThis.fetch);
      return { provider: createOpenAICompatibleProvider(
        { id: config.id ?? config.kind, baseUrl: `https://${HOST}/v1/projects/${account.project_id}/locations/global/endpoints/openapi`, apiKey: token },
        { fetch, label },
      ), traits: {} };
    },
  },
};

export default vertexai;
