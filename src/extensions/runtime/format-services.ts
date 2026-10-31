/** Extension format snapshot backed by the application's canonical adapter registry. */
import { all } from "../../core/registry";
import { extensionFormatServices } from "../operations/transfers/_services";

export function createExtensionFormatServices() {
  return extensionFormatServices(all());
}
