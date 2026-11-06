/** Primary app identity and launch arguments, distinct from advanced command-line builds. */
export const APP_ASSET_NAMES = { windows: "Bunzai.exe", linux: "Bunzai-Linux", linuxPackage: "Bunzai-Linux.deb", mac: "Bunzai-macOS" } as const;

/** Preserve explicit commands; the packaged Linux and macOS apps have a Studio-first default. */
export function packagedAppArgs(args: readonly string[], packaged: boolean, execBasename: string): string[] {
  return packaged && (execBasename === APP_ASSET_NAMES.linux || execBasename === APP_ASSET_NAMES.mac) && args.length === 0 ? ["ui"] : [...args];
}
