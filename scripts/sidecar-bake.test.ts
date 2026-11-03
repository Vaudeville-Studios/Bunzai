/** Cross-target helper bakes select only the requested file and refuse omitted build products. */
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bakeSidecar } from "./sidecar-bake";

test("each compile receives its own target-specific embedded file; missing is a build error", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunzai-sidecar-bake-"));
  try {
    await mkdir(join(root, "src", "generated"), { recursive: true }); await mkdir(join(root, "sidecar"));
    for (const [target, asset] of [["bun-linux-x64", "sidecar-linux-x64"], ["bun-linux-arm64", "sidecar-linux-arm64"]]) {
      await writeFile(join(root, "sidecar", asset!), target!);
      await bakeSidecar(root, target!);
      const code = await readFile(join(root, "src", "generated", "packaged-sidecar.ts"), "utf8");
      expect(code).toContain(`../../sidecar/${asset}`); expect(code).toContain(`"${target!.replace("bun-", "")}"`);
      expect(code.match(/import file/g)).toHaveLength(1);
    }
    const error = await bakeSidecar(root, "bun-windows-x64").then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
  } finally { await rm(root, { recursive: true, force: true }); }
});
