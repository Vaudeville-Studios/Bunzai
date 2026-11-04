/**
 * Wrap the compiled Linux app (dist/Bunzai-Linux) in dist/Bunzai-Linux.deb, so Ubuntu and Debian users
 * install it by double-click and open Bunzai from their app menu instead of a terminal. The binary keeps
 * its Bunzai-Linux name inside the package because that name is what makes a bare launch open Studio
 * (src/packaged-app.ts). Needs dpkg-deb, so it runs on the Linux release job.
 * Run: bun run scripts/build-deb.ts
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { APP_ASSET_NAMES } from "../src/packaged-app";

const pkg = JSON.parse(await Bun.file("package.json").text()) as { version: string; description: string };
const stage = mkdtempSync(join(tmpdir(), "bunzai-deb-"));
// mkdtemp makes the folder private, and the package root becomes the installed system root.
chmodSync(stage, 0o755);
const put = (path: string, from: { copy: string } | { text: string }, mode = 0o644): void => {
  const target = join(stage, path);
  mkdirSync(dirname(target), { recursive: true });
  if ("copy" in from) copyFileSync(from.copy, target);
  else writeFileSync(target, from.text);
  chmodSync(target, mode);
};

try {
  put(`usr/lib/bunzai/${APP_ASSET_NAMES.linux}`, { copy: `dist/${APP_ASSET_NAMES.linux}` }, 0o755);
  put("usr/share/icons/hicolor/256x256/apps/bunzai.png", { copy: "build/vaude-256.png" });
  put("usr/share/applications/bunzai.desktop", { text: [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Bunzai",
    "Comment=Open Bunzai Studio in your browser",
    `Exec=/usr/lib/bunzai/${APP_ASSET_NAMES.linux}`,
    "Icon=bunzai",
    "Terminal=false",
    "Categories=Utility;",
    "",
  ].join("\n") });
  put("DEBIAN/control", { text: [
    "Package: bunzai",
    `Version: ${pkg.version}`,
    "Architecture: amd64",
    "Section: utils",
    "Priority: optional",
    "Maintainer: Vaudeville Studios <https://github.com/Vaudeville-Studios/Bunzai>",
    "Homepage: https://github.com/Vaudeville-Studios/Bunzai",
    `Description: ${pkg.description}`,
    "",
  ].join("\n") });
  const out = `dist/${APP_ASSET_NAMES.linuxPackage}`;
  const built = Bun.spawnSync(["dpkg-deb", "--root-owner-group", "--build", stage, out], { stdout: "inherit", stderr: "inherit" });
  if ((built.exitCode ?? 1) !== 0) throw new Error(`dpkg-deb exited ${built.exitCode ?? 1}`);
  console.log(`wrote ${out}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
