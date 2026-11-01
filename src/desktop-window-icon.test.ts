/** Extracted Windows icons are installed on both window sizes and owned through close. */
import { expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { installExecutableIcon, type WindowIconNative } from "./desktop-window-icon";

test("uses the executable icon for small and big window slots, then destroys each owned handle once", () => {
  const events: string[] = [];
  const native: WindowIconNative = {
    extract: (path) => { events.push(`extract:${path}`); return { count: 1, small: 11n, large: 22n }; },
    set: (_window, size, icon) => { events.push(`set:${size}:${icon}`); },
    destroy: (icon) => { events.push(`destroy:${icon}`); },
    close: () => { events.push("close"); },
  };
  const release = installExecutableIcon(ptr(Buffer.alloc(8)), "Bunzai.exe", native);
  expect(events).toEqual(["extract:Bunzai.exe", "set:0:11", "set:1:22"]);
  release(); release();
  expect(events).toEqual(["extract:Bunzai.exe", "set:0:11", "set:1:22", "destroy:11", "destroy:22", "close"]);
});

test("deduplicates shared icon handles and releases a failed extraction immediately", () => {
  const events: string[] = [];
  const native: WindowIconNative = {
    extract: () => ({ count: 1, small: 11n, large: 11n }),
    set: (_window, size) => { events.push(`set:${size}`); },
    destroy: (icon) => { events.push(`destroy:${icon}`); },
    close: () => { events.push("close"); },
  };
  installExecutableIcon(ptr(Buffer.alloc(8)), "Bunzai.exe", native)();
  expect(events).toEqual(["set:0", "set:1", "destroy:11", "close"]);

  const empty: WindowIconNative = { ...native, extract: () => ({ count: 0, small: 0n, large: 0n }) };
  installExecutableIcon(ptr(Buffer.alloc(8)), "Bunzai.exe", empty)();
  expect(events.at(-1)).toBe("close");

  const broken: WindowIconNative = { ...native, extract: () => { throw new Error("resource unavailable"); }, close: () => { throw new Error("close failed"); } };
  expect(() => installExecutableIcon(null, "Bunzai.exe", broken)).not.toThrow();
  expect(() => installExecutableIcon(ptr(Buffer.alloc(8)), "Bunzai.exe", broken)).not.toThrow();
});
