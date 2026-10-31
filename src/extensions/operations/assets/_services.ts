/** Narrow, exact-piece media reference and bounded blob access port. */
import type { ResourceRef } from "../../contracts/operation";
import type { ContentKind } from "../../../entities/capabilities/types";

export interface ExtensionAssetReference { sha: string; mime: string | null; bytes: number | null }
export type ExtensionAssetRead =
  | { status: "ok"; mime: string | null; bytes: Uint8Array }
  | { status: "too-large"; mime: string | null; bytes: number };
export interface ExtensionAssetServices {
  list(kind: ContentKind, id: string, scope: readonly ResourceRef[]): Promise<readonly ExtensionAssetReference[]>;
  read(kind: ContentKind, id: string, sha: string, scope: readonly ResourceRef[], maxBytes: number): Promise<ExtensionAssetRead | null>;
}
