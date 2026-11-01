/**
 * Hand the window worker a verified WebView library outside Bun's compiled virtual resource path.
 * Linux uses its private runtime directory; Windows uses the current user's LocalAppData support
 * directory.
 */
import { lstat, mkdir } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isRecord } from "./core/guards";
import { sha256HexBytes } from "./core/sha256";
import { writeAtomicReplace } from "./studio/atomic-file";
import arm64 from "webview-bun/build/libwebview-arm64.so" with { type: "file" };
import x64 from "webview-bun/build/libwebview-x64.so" with { type: "file" };
import windowsX64 from "webview-bun/build/libwebview.dll" with { type: "file" };

const missing = (error: unknown): boolean => isRecord(error) && error["code"] === "ENOENT";
const VERIFY_ATTEMPTS = 6;

async function verifiedLibrary(target: string, bytes: Uint8Array, safe: (stat: Stats) => boolean): Promise<string | null> {
  const digest = sha256HexBytes(bytes);
  const verify = async (): Promise<boolean> => {
    try {
      let stat = await lstat(target);
      // Atomic replacement can leave lstat observing a stale, unlinked inode.
      for (let remaining = VERIFY_ATTEMPTS - 1; stat.nlink === 0 && remaining > 0; remaining--) {
        await Bun.sleep(1);
        stat = await lstat(target);
      }
      if (!safe(stat) || stat.size !== bytes.length) return false;
      const actual = await Bun.file(target).slice(0, bytes.length + 1).bytes();
      return actual.length === bytes.length && sha256HexBytes(actual) === digest;
    } catch {
      return false;
    }
  };
  try {
    await lstat(target);
  } catch (error) {
    if (!missing(error)) return null;
    try {
      await writeAtomicReplace(target, bytes, { mode: 0o600 });
    } catch {
      return null;
    }
  }
  return await verify() ? target : null;
}

async function privateWindowsDirectory(path: string): Promise<boolean> {
  try {
    try { await mkdir(path, { mode: 0o700 }); } catch (error) {
      if (!isRecord(error) || error["code"] !== "EEXIST") return false;
    }
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The window worker's environment, with WEBVIEW_PATH pointing to a verified physical library. */
export async function webviewWorkerEnv(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Promise<Record<string, string> | null> {
  if (env["WEBVIEW_PATH"]) return null;
  try {
    let directory: string;
    let filename: string;
    let bytes: Uint8Array;
    let safe: (stat: Stats) => boolean;

    if (platform === "linux" && process.getuid && (arch === "x64" || arch === "arm64")) {
      const uid = process.getuid();
      const runtimeDir = env["XDG_RUNTIME_DIR"];
      if (uid === undefined || !runtimeDir || !isAbsolute(runtimeDir)) return null;
      const stat = await lstat(runtimeDir);
      if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) return null;
      directory = runtimeDir;
      filename = `bunzai-libwebview-${arch}`;
      bytes = await Bun.file(arch === "arm64" ? arm64 : x64).bytes();
      safe = (file) => file.isFile() && !file.isSymbolicLink() && file.uid === uid && file.nlink === 1 && (file.mode & 0o077) === 0;
    } else if (platform === "win32" && arch === "x64") {
      const localAppData = env["LOCALAPPDATA"];
      if (!localAppData || !isAbsolute(localAppData) || !await privateWindowsDirectory(localAppData)) return null;
      const appData = join(localAppData, "Bunzai");
      if (!await privateWindowsDirectory(appData)) return null;
      directory = join(appData, "webview");
      if (!await privateWindowsDirectory(directory)) return null;
      filename = "libwebview";
      bytes = await Bun.file(windowsX64).bytes();
      safe = (file) => file.isFile() && !file.isSymbolicLink() && file.nlink === 1;
    } else {
      return null;
    }
    const target = join(directory, `${filename}-${sha256HexBytes(bytes)}${platform === "win32" ? ".dll" : ".so"}`);
    const path = await verifiedLibrary(target, bytes, safe);
    if (!path) return null;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) if (value !== undefined) next[key] = value;
    return { ...next, WEBVIEW_PATH: path };
  } catch {
    return null;
  }
}
