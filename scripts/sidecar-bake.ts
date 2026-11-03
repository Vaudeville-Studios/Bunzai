/** Bake exactly one compile target's helper as a file-loader asset, separately from download pins. */
import { join } from "node:path";
import { SIDECAR_TARGETS, resolveTarget } from "../sidecar/build-targets";
import { MAX_AUX_BYTES, sha256Hex } from "../src/ui/remote/aux-download";

export const SIDECAR_PLACEHOLDER = `/** Placeholder restored after compilation; source checkouts do not pretend to carry a helper. */
import type { BundledSidecar } from "../ui/remote/bundled-sidecar";
export const PACKAGED_SIDECAR: BundledSidecar | null = null;
`;

export async function bakeSidecar(root: string, target: string): Promise<void> {
  const platform = resolveTarget(target.replace(/^bun-/, ""));
  if (!platform) throw new Error(`No remote-access helper target for ${target}`);
  const asset = SIDECAR_TARGETS[platform].asset;
  const file = Bun.file(join(root, "sidecar", asset));
  if (!await file.exists()) throw new Error(`Build the matching helper first: bun sidecar/build.ts --target=${target.replace(/^bun-/, "")}`);
  if (file.size === 0 || file.size > MAX_AUX_BYTES) throw new Error(`Invalid helper size: ${asset}`);
  const hash = sha256Hex(new Uint8Array(await file.arrayBuffer()));
  await Bun.write(join(root, "src", "generated", "packaged-sidecar.ts"),
    `/** Generated target-specific embedded helper; never a published download pin. */\n` +
    `import file from "../../sidecar/${asset}" with { type: "file" };\n` +
    `export const PACKAGED_SIDECAR = { platform: ${JSON.stringify(platform)}, sha256: ${JSON.stringify(hash)}, file };\n`);
}
