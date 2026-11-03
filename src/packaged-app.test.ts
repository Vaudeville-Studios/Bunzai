/** Normal app launch opens Studio while CLI and source command behavior remains explicit. */
import { expect, test } from "bun:test";
import { APP_ASSET_NAMES, packagedAppArgs } from "./packaged-app";

test("the normal Linux app opens Studio with no arguments", () => {
  expect(packagedAppArgs([], true, APP_ASSET_NAMES.linux)).toEqual(["ui"]);
  expect(packagedAppArgs(["--help"], true, APP_ASSET_NAMES.linux)).toEqual(["--help"]);
  expect(packagedAppArgs(["version"], true, APP_ASSET_NAMES.linux)).toEqual(["version"]);
  expect(packagedAppArgs([], true, "bunzai-cli-linux-x64")).toEqual([]);
  expect(packagedAppArgs([], false, APP_ASSET_NAMES.linux)).toEqual([]);
});
