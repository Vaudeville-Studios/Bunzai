/** Persist event subscriptions through the installed package's fenced control record. */
import type { ExtensionEventServices } from "../operations/events/_services";
import { EXTENSION_EVENT_IDS, extensionEventSubscriptionSchema, type ExtensionEventId, type ExtensionEventSubscription } from "../contracts/events";
import { inspectExtensionPackage } from "../contracts/package-validation";
import type { ExtensionCommitContext, ExtensionStore } from "../../stage/contracts/extension-store";

const sameSubscription = (a: ExtensionEventSubscription, b: ExtensionEventSubscription): boolean => a.scope === b.scope && a.event === b.event
  && (a.scope === "scene" && b.scope === "scene" ? a.sceneId === b.sceneId
    : a.scope === "content" && b.scope === "content" && a.resource.kind === b.resource.kind && a.resource.id === b.resource.id);

async function declared(store: ExtensionStore, digest: string, event: string): Promise<boolean> {
  const stored = await store.readPackage(digest);
  if (!stored) throw new Error("installed extension package is unavailable");
  const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown;
  const pkg = (await inspectExtensionPackage(raw)).package;
  const eventId = EXTENSION_EVENT_IDS.find((id) => id === event) as ExtensionEventId | undefined;
  return !!eventId && pkg.manifest.contributions.some((item) => item.type === "panel" && item.events.includes(eventId));
}

function hasGrant(control: Awaited<ReturnType<ExtensionStore["readControl"]>>, subscription: ExtensionEventSubscription, operation: string): boolean {
  if (!control) return false;
  const target = subscription.scope === "scene" ? { kind: "scene", id: subscription.sceneId } : subscription.resource;
  return control.grants.some((grant) => grant.operation === operation
    && grant.resources.some((resource) => resource.kind === "event" && resource.id === subscription.event)
    && grant.resources.some((resource) => resource.kind === target.kind && resource.id === target.id));
}

export function createExtensionEventServices(store: ExtensionStore): ExtensionEventServices {
  const change = async (packageId: string, raw: ExtensionEventSubscription, commit: ExtensionCommitContext, add: boolean): Promise<boolean> => {
    const subscription = extensionEventSubscriptionSchema.parse(raw);
    const operation = add ? "events.subscribe" : "events.unsubscribe";
    if (commit.packageId !== packageId || commit.operation !== operation) throw new Error("event subscription principal mismatch");
    const control = await store.readControl(packageId);
    if (!control || !control.enabled || control.recoveryRequired || control.hostTrusted || control.packageDigest !== commit.packageDigest
      || control.policyFingerprint !== commit.policyFingerprint || control.grantRevision !== commit.grantRevision || !hasGrant(control, subscription, operation)) {
      throw new Error("event subscription authority changed");
    }
    if (!await declared(store, control.packageDigest, subscription.event)) throw new Error("event is not declared by the installed package");
    const present = control.eventSubscriptions.some((item) => sameSubscription(item, subscription));
    if (present === add) return false;
    const eventSubscriptions = add ? [...control.eventSubscriptions, subscription] : control.eventSubscriptions.filter((item) => !sameSubscription(item, subscription));
    if (eventSubscriptions.length > 128) throw new Error("extension event subscription limit reached");
    const next = { ...control, eventSubscriptions, revision: control.revision + 1 };
    return await store.compareAndSaveControl(next, control.revision, commit) === "saved";
  };
  return {
    subscribe: (packageId, subscription, commit) => change(packageId, subscription, commit, true),
    unsubscribe: (packageId, subscription, commit) => change(packageId, subscription, commit, false),
  };
}
