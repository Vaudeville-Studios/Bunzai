/** Generated extension operation factory seam. Source: operation folders. */
import { createOperationCatalog } from "../extensions/catalog/operations";
import type { ExtensionOperationServices } from "../extensions/operations/_services";
import * as operationModule0 from "../extensions/operations/api/describe";
import * as operationModule1 from "../extensions/operations/api/status";
import * as operationModule2 from "../extensions/operations/assets/mutation-operations";
import * as operationModule3 from "../extensions/operations/assets/operations";
import * as operationModule4 from "../extensions/operations/clipboard/operations";
import * as operationModule5 from "../extensions/operations/collections/list";
import * as operationModule6 from "../extensions/operations/collections/read-write";
import * as operationModule7 from "../extensions/operations/commands/register";
import * as operationModule8 from "../extensions/operations/content/field-reads";
import * as operationModule9 from "../extensions/operations/content/history-operations";
import * as operationModule10 from "../extensions/operations/content/kinds";
import * as operationModule11 from "../extensions/operations/content/lifecycle-operations";
import * as operationModule12 from "../extensions/operations/content/links-operations";
import * as operationModule13 from "../extensions/operations/content/read";
import * as operationModule14 from "../extensions/operations/content/semantic-drafts";
import * as operationModule15 from "../extensions/operations/content/summary-operations";
import * as operationModule16 from "../extensions/operations/diagnostics/macros-preview";
import * as operationModule17 from "../extensions/operations/diagnostics/operations";
import * as operationModule18 from "../extensions/operations/events/subscription-operations";
import * as operationModule19 from "../extensions/operations/files/pick-read";
import * as operationModule20 from "../extensions/operations/files/write-operations";
import * as operationModule21 from "../extensions/operations/links/open";
import * as operationModule22 from "../extensions/operations/logs/operations";
import * as operationModule23 from "../extensions/operations/models/operations";
import * as operationModule24 from "../extensions/operations/network/request";
import * as operationModule25 from "../extensions/operations/playback/operations";
import * as operationModule26 from "../extensions/operations/prompts/operations";
import * as operationModule27 from "../extensions/operations/regex/preview";
import * as operationModule28 from "../extensions/operations/scenes/create";
import * as operationModule29 from "../extensions/operations/scenes/mutations";
import * as operationModule30 from "../extensions/operations/scenes/operations";
import * as operationModule31 from "../extensions/operations/scenes/settings";
import * as operationModule32 from "../extensions/operations/settings/read";
import * as operationModule33 from "../extensions/operations/settings/update";
import * as operationModule34 from "../extensions/operations/state/scene-state-operations";
import * as operationModule35 from "../extensions/operations/storage/read-operations";
import * as operationModule36 from "../extensions/operations/storage/write-operations";
import * as operationModule37 from "../extensions/operations/tools/operations";
import * as operationModule38 from "../extensions/operations/transfers/export-preview";
import * as operationModule39 from "../extensions/operations/transfers/export-write";
import * as operationModule40 from "../extensions/operations/transfers/format-operations";
import * as operationModule41 from "../extensions/operations/transfers/import-apply";
import * as operationModule42 from "../extensions/operations/transfers/import-preview";
import * as operationModule43 from "../extensions/operations/transfers/transfer-preview";
import * as operationModule44 from "../extensions/operations/turns/operations";
import * as operationModule45 from "../extensions/operations/ui/composer-draft";
import * as operationModule46 from "../extensions/operations/ui/operations";

export function createExtensionOperations(services: ExtensionOperationServices) {
  return createOperationCatalog([
  ...operationModule0.createOperations(services),
  ...operationModule1.createOperations(services),
  ...operationModule2.createOperations(services),
  ...operationModule3.createOperations(services),
  ...operationModule4.createOperations(services),
  ...operationModule5.createOperations(services),
  ...operationModule6.createOperations(services),
  ...operationModule7.createOperations(services),
  ...operationModule8.createOperations(services),
  ...operationModule9.createOperations(services),
  ...operationModule10.createOperations(services),
  ...operationModule11.createOperations(services),
  ...operationModule12.createOperations(services),
  ...operationModule13.createOperations(services),
  ...operationModule14.createOperations(services),
  ...operationModule15.createOperations(services),
  ...operationModule16.createOperations(services),
  ...operationModule17.createOperations(services),
  ...operationModule18.createOperations(services),
  ...operationModule19.createOperations(services),
  ...operationModule20.createOperations(services),
  ...operationModule21.createOperations(services),
  ...operationModule22.createOperations(services),
  ...operationModule23.createOperations(services),
  ...operationModule24.createOperations(services),
  ...operationModule25.createOperations(services),
  ...operationModule26.createOperations(services),
  ...operationModule27.createOperations(services),
  ...operationModule28.createOperations(services),
  ...operationModule29.createOperations(services),
  ...operationModule30.createOperations(services),
  ...operationModule31.createOperations(services),
  ...operationModule32.createOperations(services),
  ...operationModule33.createOperations(services),
  ...operationModule34.createOperations(services),
  ...operationModule35.createOperations(services),
  ...operationModule36.createOperations(services),
  ...operationModule37.createOperations(services),
  ...operationModule38.createOperations(services),
  ...operationModule39.createOperations(services),
  ...operationModule40.createOperations(services),
  ...operationModule41.createOperations(services),
  ...operationModule42.createOperations(services),
  ...operationModule43.createOperations(services),
  ...operationModule44.createOperations(services),
  ...operationModule45.createOperations(services),
  ...operationModule46.createOperations(services),
  ]);
}
