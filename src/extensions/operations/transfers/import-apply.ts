/** Apply an imported draft through the shared, fingerprint-bound draft apply handler. */
import { createDraftApplyOperation } from "../content/_draft-apply";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const operation = createDraftApplyOperation({
  id: "import.apply", title: "Apply an imported piece",
  description: "Apply one imported canonical piece draft after the host reviews its complete changes and current revision.",
  hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
});
export const importApplyOperations = [operation] as const;
export const createOperations = (services: ExtensionOperationServices) => importApplyOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default importApplyOperations;
