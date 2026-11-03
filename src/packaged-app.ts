/** Primary app identity and launch arguments, distinct from advanced command-line builds. */
export const APP_ASSET_NAMES = { windows: "Bunzai.exe", linux: "Bunzai-Linux" } as const;

/** Preserve explicit commands; only the packaged Linux app has a Studio-first default. */
export function packagedAppArgs(args: readonly string[], packaged: boolean, execBasename: string): string[] {
  return packaged && execBasename === APP_ASSET_NAMES.linux && args.length === 0 ? ["ui"] : [...args];
}
