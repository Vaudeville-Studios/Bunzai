/** Verify and materialize the executable's own helper without a download or process start. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auxSidecarDir } from "../../app-data";
import { writeAtomicReplace } from "../../studio/atomic-file";
import { MAX_AUX_BYTES, platformKey, sha256Hex } from "./aux-download";
import { PACKAGED_SIDECAR } from "../../generated/packaged-sidecar";

export interface BundledSidecar {
  platform: string;
  sha256: string;
  file: string;
}

/** Returns only a verified path. A failed preparation cannot make an old or corrupt cache runnable. */
export async function prepareBundledSidecar(
  helper: BundledSidecar | null = PACKAGED_SIDECAR,
  directory = auxSidecarDir(),
  platform = platformKey(),
): Promise<string | null> {
  if (!helper) return null;
  if (helper.platform !== platform || !/^[a-f0-9]{64}$/.test(helper.sha256)) throw new Error("The included remote-access helper does not match this app.");
  const source = Bun.file(helper.file);
  if (source.size === 0 || source.size > MAX_AUX_BYTES) throw new Error("The included remote-access helper has an invalid size.");
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (sha256Hex(bytes) !== helper.sha256) throw new Error("The included remote-access helper failed its integrity check.");
  const dir = join(directory, "bundled", helper.sha256);
  const target = join(dir, platform.startsWith("win32-") ? "sidecar.exe" : "sidecar");
  const cached = Bun.file(target);
  if (await cached.exists()) {
    if (cached.size <= MAX_AUX_BYTES && sha256Hex(new Uint8Array(await cached.arrayBuffer())) === helper.sha256) return target;
  }
  await mkdir(dir, { recursive: true });
  await writeAtomicReplace(target, bytes, platform.startsWith("win32-") ? undefined : { mode: 0o700 });
  return target;
}

/** Helper extraction must not prevent local Studio use; missing-helper recovery remains available. */
export async function prepareAppSidecar(): Promise<string | undefined> {
  try { return await prepareBundledSidecar() ?? undefined; }
  catch (error) { console.warn("Remote helper could not be prepared; local Studio remains available:", error); return undefined; }
}
