/** Event subscription mutations persist in the installed control, never guest storage. */
import type { ExtensionEventSubscription } from "../../contracts/events";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";

export interface ExtensionEventServices {
  subscribe(packageId: string, subscription: ExtensionEventSubscription, commit: ExtensionCommitContext): Promise<boolean>;
  unsubscribe(packageId: string, subscription: ExtensionEventSubscription, commit: ExtensionCommitContext): Promise<boolean>;
}
