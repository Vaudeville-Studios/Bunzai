/** Workbench editor read and save wire shapes. */
import type { StudioEntitySummary } from "./app-contract";
import type { PromptAttachmentMime } from "../core/media/mime";

export interface EditableEntity {
  entity: unknown;
  revision: string;
}

export interface LightEditableEntity {
  entity: unknown;
  revision: string;
  version: number;
  assets: Record<string, string>;
}

export interface StagedAssetUpload {
  sha: string;
  mime: PromptAttachmentMime;
  bytes: number;
  ref: string;
  asset: string;
  /** A grant over a picture the library already holds (a pack copied whole): it carries no bytes and does not count against the upload limits. */
  adopted?: true;
}

export interface EditedEntitySave {
  summary: StudioEntitySummary;
  revision: string;
}
