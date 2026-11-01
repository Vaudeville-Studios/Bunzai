/** Browser-safe, bounded JSON transport helpers shared by the local and Pocket extension routes. */
import { readStreamCapped } from "../core/stream-bytes";
import { JSON_BODY_MAX_BYTES } from "../core/media/limits";
import { isRecord } from "../core/guards";

export const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
export const err = (message: string, status = 400): Response => json({ error: message }, status);

export function refuseDeclaredLength(request: Request, limit: number): Response | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const length = Number(raw);
  return !Number.isFinite(length) || length < 0 ? err("invalid content-length", 400) : length > limit ? err("payload too large", 413) : null;
}

export const refusal = (reason: "too-large" | "aborted" | "failed"): Response =>
  reason === "too-large" ? err("payload too large", 413) : err("failed to read body", 400);

export async function readBodyCapped(request: Request, limit: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: Response }> {
  const refused = refuseDeclaredLength(request, limit);
  if (refused) return { ok: false, response: refused };
  const read = await readStreamCapped(request.body, limit, { signal: request.signal, sizeHint: Number(request.headers.get("content-length") ?? 0) });
  if (read.ok) return read;
  return { ok: false, response: err(read.reason === "too-large" ? "payload too large" : "failed to read body", read.reason === "too-large" ? 413 : 400) };
}

async function parseJsonBodyCapped(request: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const capped = await readBodyCapped(request, limit);
  if (!capped.ok) return capped;
  if (capped.bytes.length === 0) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(capped.bytes)) as unknown }; }
  catch { return { ok: false, response: err("invalid json", 400) }; }
}

export async function readJsonObject(request: Request, limit = JSON_BODY_MAX_BYTES): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, response: err("unsupported media type", 415) };
  const parsed = await parseJsonBodyCapped(request, limit);
  if (!parsed.ok) return parsed;
  return isRecord(parsed.value) ? { ok: true, value: parsed.value } : { ok: false, response: err("expected an object", 400) };
}
