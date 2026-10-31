/** Applies the icon resource already embedded in Bunzai.exe to the native WebView window. */
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const failedExtraction = 0xffff_ffff;
const noop = () => {};

export interface WindowIconNative {
  extract(path: string): { count: number; small: bigint; large: bigint };
  set(window: Pointer, size: typeof ICON_SMALL | typeof ICON_BIG, icon: bigint): void;
  destroy(icon: bigint): void;
  close(): void;
}

/** Testable ownership boundary: the extracted handles live until the native window has closed. */
export function installExecutableIcon(window: Pointer | null, path: string, native: WindowIconNative): () => void {
  const close = () => { try { native.close(); } catch {} };
  if (!window) { close(); return noop; }
  let icons: { count: number; small: bigint; large: bigint };
  try { icons = native.extract(path); } catch { close(); return noop; }
  const handles = [...new Set([icons.small, icons.large].filter((handle) => handle !== 0n))];
  const release = () => {
    for (const handle of handles) { try { native.destroy(handle); } catch {} }
    try { native.close(); } catch {}
  };
  if (icons.count === 0 || icons.count === failedExtraction || handles.length === 0) { release(); return noop; }
  try {
    if (icons.small !== 0n) native.set(window, ICON_SMALL, icons.small);
    if (icons.large !== 0n) native.set(window, ICON_BIG, icons.large);
  } catch { /* A missing native icon must not prevent the WebView window from opening. */ }
  let released = false;
  return () => { if (!released) { released = true; release(); } };
}

function windowsIconNative(): WindowIconNative | null {
  const shellSymbols = { ExtractIconExW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 } } as const;
  const userSymbols = {
    SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64_fast, FFIType.u64_fast], returns: FFIType.i64_fast },
    DestroyIcon: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  } as const;
  try {
    const shell = dlopen("shell32.dll", shellSymbols);
    try {
      const user = dlopen("user32.dll", userSymbols);
      return {
        extract(path) {
          const filename = Buffer.from(`${path}\0`, "utf16le");
          const large = new BigUint64Array(1), small = new BigUint64Array(1);
          const count = shell.symbols.ExtractIconExW(ptr(filename), 0, ptr(large), ptr(small), 1);
          return { count, large: large[0]!, small: small[0]! };
        },
        set: (window, size, icon) => { user.symbols.SendMessageW(window, WM_SETICON, BigInt(size), icon); },
        destroy: (icon) => { user.symbols.DestroyIcon(icon); },
        close() { try { user.close(); } finally { shell.close(); } },
      };
    } catch {
      try { shell.close(); } catch {}
      return null;
    }
  } catch {
    return null;
  }
}

/** Best effort; non-Windows windows keep the platform's normal app-icon path. */
export function setExecutableWindowIcon(window: Pointer | null): () => void {
  if (process.platform !== "win32" || !window) return noop;
  const native = windowsIconNative();
  return native ? installExecutableIcon(window, process.execPath, native) : noop;
}
