/** Trusted narrow host-service ports bound to generated operation definitions. */
import type { ExtensionContentServices } from "../contracts/operation";
import type { ExtensionStorageServices } from "./storage/_services";
import type { ExtensionNetworkServices } from "./network/_services";
import type { ExtensionSceneStateServices } from "./state/_services";
import type { ExtensionEventServices } from "./events/_services";
import type { ExtensionDraftServices } from "./content/_draft-services";
import type { ExtensionFileServices } from "./files/_services";
import type { ExtensionSettingsServices } from "./settings/_services";
import type { ExtensionModelServices } from "./models/_services";
import type { ExtensionCollectionServices } from "./collections/_services";
import type { ExtensionFormatServices, ExtensionTransferServices } from "./transfers/_services";
import type { ExtensionAssetServices } from "./assets/_services";
import type { ExtensionSceneServices } from "./scenes/_services";
import type { HostActionPort } from "../runtime/host-action-port";
import type { ExtensionLogServices } from "./logs/_services";
import type { ExtensionKitToolServices } from "./tools/_services";
import type { ExtensionRegexPreviewServices } from "./regex/_services";
import type { ExtensionCommandServices } from "./commands/_services";
import type { ExtensionTurnServices } from "./turns/_services";

export interface ExtensionOperationServices {
  content: ExtensionContentServices;
  /** Present only when the runtime binds the per-package fenced extension-data adapter. */
  storage?: ExtensionStorageServices;
  network?: ExtensionNetworkServices;
  sceneState?: ExtensionSceneStateServices;
  events?: ExtensionEventServices;
  drafts?: ExtensionDraftServices;
  files?: ExtensionFileServices;
  settings?: ExtensionSettingsServices;
  models?: ExtensionModelServices;
  collections?: ExtensionCollectionServices;
  assets?: ExtensionAssetServices;
  scenes?: ExtensionSceneServices;
  hostActions?: HostActionPort;
  formats?: ExtensionFormatServices;
  transfers?: ExtensionTransferServices;
  logs?: ExtensionLogServices;
  tools?: ExtensionKitToolServices;
  regex?: ExtensionRegexPreviewServices;
  commands?: ExtensionCommandServices;
  turns?: ExtensionTurnServices;
}
