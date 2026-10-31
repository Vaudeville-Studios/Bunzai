/** Generated extension operation factory seam. Source: operation folders. */
import { createOperationCatalog } from "../extensions/catalog/operations";
import type { ExtensionOperationServices } from "../extensions/operations/_services";
import * as operationModule0 from "../extensions/operations/api/describe";
import * as operationModule1 from "../extensions/operations/api/status";
import * as operationModule2 from "../extensions/operations/assets/mutation-operations";
import * as operationModule3 from "../extensions/operations/assets/operations";
import * as operationModule4 from "../extensions/operations/collections/list";
import * as operationModule5 from "../extensions/operations/collections/read-write";
import * as operationModule6 from "../extensions/operations/commands/register";
import * as operationModule7 from "../extensions/operations/content/field-reads";
import * as operationModule8 from "../extensions/operations/content/history-operations";
import * as operationModule9 from "../extensions/operations/content/kinds";
import * as operationModule10 from "../extensions/operations/content/lifecycle-operations";
import * as operationModule11 from "../extensions/operations/content/links-operations";
import * as operationModule12 from "../extensions/operations/content/read";
import * as operationModule13 from "../extensions/operations/content/semantic-drafts";
import * as operationModule14 from "../extensions/operations/content/summary-operations";
import * as operationModule15 from "../extensions/operations/diagnostics/macros-preview";
import * as operationModule16 from "../extensions/operations/diagnostics/operations";
import * as operationModule17 from "../extensions/operations/events/subscription-operations";
import * as operationModule18 from "../extensions/operations/logs/operations";
import * as operationModule19 from "../extensions/operations/prompts/operations";
import * as operationModule20 from "../extensions/operations/regex/preview";
import * as operationModule21 from "../extensions/operations/scenes/create";
import * as operationModule22 from "../extensions/operations/scenes/mutations";
import * as operationModule23 from "../extensions/operations/scenes/operations";
import * as operationModule24 from "../extensions/operations/scenes/settings";
import * as operationModule25 from "../extensions/operations/settings/read";
import * as operationModule26 from "../extensions/operations/settings/update";
import * as operationModule27 from "../extensions/operations/state/scene-state-operations";
import * as operationModule28 from "../extensions/operations/storage/read-operations";
import * as operationModule29 from "../extensions/operations/storage/write-operations";
import * as operationModule30 from "../extensions/operations/ui/composer-draft";
import * as operationModule31 from "../extensions/operations/ui/operations";

export function createBrowserExtensionOperations(services: ExtensionOperationServices) {
  return createOperationCatalog([
  ...operationModule0.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule1.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule2.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule3.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule4.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule5.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule6.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule7.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule8.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule9.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule10.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule11.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule12.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule13.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule14.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule15.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule16.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule17.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule18.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule19.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule20.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule21.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule22.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule23.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule24.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule25.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule26.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule27.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule28.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule29.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule30.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ...operationModule31.createOperations(services).filter((operation) => operation.hosts.includes("browser")),
  ]);
}
