/** Purpose: manage installed packages and render host-controlled reviews, actions and effect confirmations. */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { SettingsSection } from "../section-contract";
import type { AppContext } from "../../../app-contract";
import { toErrorMessage } from "../../../../error-message";
import type { InstalledExtensionSummary, ExtensionPackagePreview, ExtensionActivationResult, ExtensionPromptPreview } from "../../../../extensions/runtime/service";
import type { ExtensionGrant } from "../../../../extensions/contracts/grants";
import type { JsonValue } from "../../../../extensions/contracts/value";
import { decodeInteractiveDescriptor, type InteractiveDescriptor } from "../../../../extensions/contracts/interactive";
import type { ThemeScope } from "../../../../extensions/theme-appearance";
import type { PendingExtensionEffect } from "../../../../extensions/runtime/confirmation";
import type { ExtensionHostActionAnswer, ExtensionHostActionSnapshot, PendingExtensionHostAction } from "../../../../extensions/contracts/host-actions";
import { fileWriteEffectReviewSchema, type PendingExtensionFileAction } from "../../../../extensions/contracts/file-actions";
import { extensionOperationMetadata } from "../../../../generated/extension-operation-metadata";
import { EXTENSION_BUDGET_PRESETS } from "../../../../extensions/contracts/operation";
import type { OperationMetadata } from "../../../../extensions/catalog/operations";
import { Button, Disclosure } from "../../../components/button";
import { DialogCore } from "../../../components/dialog-core";
import { Checkbox, Input, Select, Textarea } from "../../../components/rc-controls";
import { ProtectedLine } from "../section-contract";
import { ExtensionRenderer } from "../../../extensions/renderer";
import { ExtensionSettingsEditor } from "../../../extensions/settings-editor";
import { EffectReview } from "../../../extensions/effect-review";
import { answerExtensionFileAction } from "../../../extensions/file-actions";
import { createExtensionFileRegistry } from "../../../extensions/file-handles";
import { runExtensionHostActionGesture } from "../../../extensions/host-action-gesture";
import { runExtensionRegexPreview } from "../../../extensions/regex-preview";
import { runExtensionSceneTurnRegex } from "../../../extensions/scene-turn-regex";
import { replaceComposerDraft } from "../../scenes/context/draft-bus";
import { sharedMusic } from "../../scenes/use-stage-music";
import { useMusicLibrary } from "../../scenes/use-music-library";
import { handOffScene, waitForSceneHandoff, SCENES_APP } from "../../../_shared/scene-handoff";
import { useVisibleInterval } from "../../../_shared/use-visible-interval";
import styles from "./extensions.module.css";

interface Review { preview: ExtensionPackagePreview; installedId?: string; replacementId?: string; grants: Record<string, boolean>; resourceIds: Record<string, string>; fields: Record<string, string[]>; methods: Record<string, ExtensionGrant["methods"]>; destinations: Record<string, string[]>; budgetLevels: Record<string, "full" | "half" | "tenth" | "custom">; budgets: Record<string, ExtensionGrant["budget"]>; durations: Record<string, ExtensionGrant["duration"]>; themeScopes: ThemeScope[] }
const operationById: ReadonlyMap<string, OperationMetadata> = new Map<string, OperationMetadata>(extensionOperationMetadata.map((operation) => [operation.id, operation] as [string, OperationMetadata]));
const errText = (error: unknown): string => toErrorMessage(error, "Extension request failed.");
const hasLocalHandle = (registry: ReturnType<typeof createExtensionFileRegistry>, ticket: Exclude<PendingExtensionFileAction, { action: "pick" }>): boolean => registry.has(ticket.handleId, {
  storeId: ticket.principal.storeId, packageId: ticket.principal.packageId, packageDigest: ticket.principal.packageDigest, grantRevision: ticket.principal.grantRevision, runEpoch: ticket.principal.runEpoch,
});
const panelKey = (packageId: string, digest: string, contributionId: string): string => `${packageId}\0${digest}\0${contributionId}`;
const imageIds = (descriptor: InteractiveDescriptor): string[] => {
  const ids = new Set<string>(), stack = [descriptor.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === "image") ids.add(node.asset);
    else if (node.type === "row" || node.type === "stack") stack.push(...node.children);
    else if (node.type === "list") stack.push(...node.items);
  }
  return [...ids];
};
const descriptorOf = (result: ExtensionActivationResult | null): InteractiveDescriptor | null => {
  if (!result || !("descriptor" in result)) return null;
  try { return decodeInteractiveDescriptor(result.descriptor); } catch { return null; }
};
const imageRefs = (item: InstalledExtensionSummary, key: string, descriptor: InteractiveDescriptor) => {
  if (!item.themeScopes.includes("appearance.assets") || !item.theme) return [];
  return imageIds(descriptor).flatMap((assetId) => {
    const asset = item.theme!.assets.find((candidate) => candidate.id === assetId);
    return asset ? [{ key, packageId: item.id, themeDigest: item.theme!.digest, ...asset }] : [];
  });
};
type ExtensionCommandContribution = Extract<InstalledExtensionSummary["contributions"][number], { type: "command" }>;
const registeredCommands = (item: InstalledExtensionSummary): ExtensionCommandContribution[] =>
  item.contributions.filter((entry): entry is ExtensionCommandContribution => entry.type === "command" && item.registeredCommands.includes(entry.id));
const safeDestination = (value: string): string => { try { const url = new URL(value); url.hash = ""; return url.toString(); } catch { return "Unrecognized destination"; } };
const previewHasReadAndEgress = (review: Review): boolean => {
  const selected = review.preview.package.manifest.requirements.filter((requirement) => review.grants[requirement.operation]).map((requirement) => operationById.get(requirement.operation));
  return selected.some((operation) => operation?.effect === "read") && selected.some((operation) => operation?.effect === "external");
};
const budgetFor = (kind: keyof typeof EXTENSION_BUDGET_PRESETS, level: Review["budgetLevels"][string]): ExtensionGrant["budget"] => {
  const max = EXTENSION_BUDGET_PRESETS[kind], scale = level === "full" ? 1 : level === "half" ? 0.5 : 0.1;
  return { requests: Math.max(1, Math.floor(max.requests * scale)), bytes: Math.floor(max.bytes * scale), tokens: Math.floor(max.tokens * scale) };
};
const resourcesFor = (operation: string, kinds: readonly string[], values: Readonly<Record<string, string>>): ExtensionGrant["resources"] => {
  const resources = kinds.flatMap((kind) => (values[`${operation}:${kind}`] ?? "").split(",").map((id) => id.trim()).filter(Boolean).map((id) => ({ kind, id })));
  if (resources.length > 256 || resources.some((resource) => resource.id.length > 160)) throw new Error("Resource access is limited to 256 IDs of at most 160 characters each.");
  return resources;
};

export function ExtensionManager({ ctx }: { ctx: AppContext }): JSX.Element {
  const [items, setItems] = useState<readonly InstalledExtensionSummary[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [pendingEffects, setPendingEffects] = useState<readonly PendingExtensionEffect[]>([]);
  const [pendingFileActions, setPendingFileActions] = useState<readonly PendingExtensionFileAction[]>([]);
  const [hostActions, setHostActions] = useState<ExtensionHostActionSnapshot>({ actions: [], panels: [], statuses: [], notices: [] });
  const [panelAssets, setPanelAssets] = useState<Record<string, Record<string, string>>>({});
  const [rendered, setRendered] = useState<Record<string, { digest: string; result: ExtensionActivationResult }>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [activityOpen, setActivityOpen] = useState<Record<string, boolean>>({});
  const [uninstallTarget, setUninstallTarget] = useState<InstalledExtensionSummary | null>(null);
  const [promptScenes, setPromptScenes] = useState<readonly { id: string; title: string }[]>([]);
  const [promptSceneId, setPromptSceneId] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [promptPreview, setPromptPreview] = useState<ExtensionPromptPreview | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const musicLibrary = useMusicLibrary(ctx);
  const assetRefs = useMemo(() => {
    const panels = hostActions.panels.flatMap((panel) => {
      const item = items.find((candidate) => candidate.id === panel.packageId);
      return !item?.enabled || item.digest !== panel.digest ? [] : imageRefs(item, panelKey(item.id, item.digest, panel.contributionId), panel.descriptor);
    });
    const results = items.flatMap((item) => {
      const result = rendered[item.id]?.digest === item.digest && item.enabled ? rendered[item.id]!.result : null;
      const descriptor = descriptorOf(result);
      return descriptor ? imageRefs(item, panelKey(item.id, item.digest, "$activation"), descriptor) : [];
    });
    return [...panels, ...results];
  }, [hostActions.panels, items, rendered]);
  const revisionSeen = useRef("");
  const runEpochs = useRef(new Map<string, number>());
  const itemsRef = useRef<readonly InstalledExtensionSummary[]>([]);
  const fileRegistry = useRef<ReturnType<typeof createExtensionFileRegistry> | null>(null);
  const musicRelease = useRef<(() => void) | null>(null);
  const answeredStatus = useRef(new Set<string>());
  const revisionLive = useRef(true);
  const revisionChecking = useRef(false);
  if (!fileRegistry.current) fileRegistry.current = createExtensionFileRegistry({ id: () => crypto.randomUUID() });
  const invalidateRun = useCallback((id: string): void => { runEpochs.current.set(id, (runEpochs.current.get(id) ?? 0) + 1); fileRegistry.current?.invalidatePackage(id); }, []);
  useEffect(() => () => { fileRegistry.current?.close(); musicRelease.current?.(); musicRelease.current = null; }, []);
  useEffect(() => {
    const controller = new AbortController(); let live = true; const created: string[] = [];
    void Promise.all(assetRefs.map(async (asset) => {
      const bytes = await ctx.api.readExtensionThemeAsset(asset.packageId, asset.id, asset.themeDigest, asset.digest, asset.mediaType, controller.signal);
      if (!live) return null;
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: asset.mediaType }));
      created.push(url);
      return { key: asset.key, id: asset.id, url };
    })).then((loaded) => {
      if (!live) return;
      const next: Record<string, Record<string, string>> = {};
      for (const item of loaded) if (item) (next[item.key] ??= {})[item.id] = item.url;
      setPanelAssets(next);
    }).catch(() => { if (live) setPanelAssets({}); });
    return () => { live = false; controller.abort(); created.forEach((url) => URL.revokeObjectURL(url)); };
  // The memoized references change only with current package/digest/panel/image identities.
  }, [ctx, assetRefs]);
  const refresh = useCallback(async () => {
    try { const next = await ctx.api.extensions.list(); itemsRef.current = next; setItems(next); }
    catch (error) { setNote(errText(error)); }
    finally { setLoading(false); }
  }, [ctx]);
  const refreshPending = useCallback(async () => {
    try { const [effects, actions, host] = await Promise.all([ctx.api.extensions.pendingEffects(), ctx.api.extensions.pendingFileActions(), ctx.api.extensions.hostActions()]); setPendingEffects(effects); setPendingFileActions(actions); setHostActions(host); }
    catch (error) { setNote(errText(error)); }
  }, [ctx]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let live = true;
    const listPromptScenes = ctx.api.extensions.promptScenes;
    if (typeof listPromptScenes !== "function") { setNote("Local prompt preview is unavailable on this host."); return () => { live = false; }; }
    void listPromptScenes().then((scenes) => { if (live) { setPromptScenes(scenes); setPromptSceneId((current) => scenes.some((scene) => scene.id === current) ? current : scenes[0]?.id ?? ""); } })
      .catch((error: unknown) => { if (live) setNote(errText(error)); });
    return () => { live = false; };
  }, [ctx]);
  const checkRevision = useCallback(async (): Promise<void> => {
    if (!revisionLive.current || revisionChecking.current) return;
    revisionChecking.current = true;
    try {
      const [next, pending, fileActions, host] = await Promise.all([ctx.api.extensions.revision(), ctx.api.extensions.pendingEffects(), ctx.api.extensions.pendingFileActions(), ctx.api.extensions.hostActions()]);
      if (!revisionLive.current) return;
      setPendingEffects(pending);
      setPendingFileActions(fileActions);
      setHostActions(host);
      for (const ticket of host.actions) if (ticket.action === "playback.status" && !answeredStatus.current.has(ticket.id)) {
        answeredStatus.current.add(ticket.id);
        const state = sharedMusic.get();
        const track = state.track ? { assetId: state.track.sha, title: state.track.title, packId: state.track.packId } : null;
        void ctx.api.extensions.answerHostAction(ticket.id, { status: "playback-state", playing: state.playing, track }).catch(() => false);
      }
      for (const id of answeredStatus.current) if (!host.actions.some((ticket) => ticket.id === id)) answeredStatus.current.delete(id);
      if (revisionSeen.current && next !== revisionSeen.current) { itemsRef.current.forEach((item) => invalidateRun(item.id)); setRendered({}); await refresh(); }
      revisionSeen.current = next;
    } catch { /* the next manager refresh reports a runtime outage */ }
    finally { revisionChecking.current = false; }
  }, [ctx, invalidateRun, refresh]);
  useEffect(() => { revisionLive.current = true; void checkRevision(); return () => { revisionLive.current = false; }; }, [checkRevision]);
  useVisibleInterval(() => { void checkRevision(); }, 2_000);
  const inspect = async (raw: unknown, installedId?: string): Promise<void> => {
    setBusy(true); setNote("");
    try {
      const preview = installedId ? await ctx.api.extensions.previewInstalled(installedId) : await ctx.api.extensions.preview(raw);
      const initial = Object.fromEntries(preview.package.manifest.requirements.map((req) => [req.operation, req.required]));
      const currentGrants = new Map<string, ExtensionGrant>();
      for (const grant of installedId ? items.find((item) => item.id === installedId)?.grants ?? [] : []) currentGrants.set(grant.operation, grant);
      const resourceIds: Record<string, string> = {};
      const fields: Record<string, string[]> = {};
      const methods = Object.fromEntries(preview.package.manifest.requirements.map((req) => [req.operation, [...req.methods]]));
      const destinations = Object.fromEntries(preview.package.manifest.requirements.map((req) => [req.operation, [...req.destinations]]));
      const budgetLevels: Review["budgetLevels"] = Object.fromEntries(preview.package.manifest.requirements.map((req) => [req.operation, "full" as const]));
      const durations: Review["durations"] = Object.fromEntries(preview.package.manifest.requirements.map((req) => [req.operation, "session" as const]));
      const budgets: Record<string, ExtensionGrant["budget"]> = {};
      for (const requirement of preview.package.manifest.requirements) {
        const grant = currentGrants.get(requirement.operation);
        fields[requirement.operation] = [...(grant?.fields ?? requirement.fields)];
        for (const kind of requirement.resources) resourceIds[`${requirement.operation}:${kind}`] = (grant?.resources ?? []).filter((resource) => resource.kind === kind).map((resource) => resource.id).join(", ");
        if (!grant) continue;
        initial[requirement.operation] = true;
        methods[requirement.operation] = [...grant.methods]; destinations[requirement.operation] = [...grant.destinations]; durations[requirement.operation] = grant.duration; budgets[requirement.operation] = grant.budget;
        const meta = operationById.get(requirement.operation);
        if (meta) budgetLevels[requirement.operation] = (["full", "half", "tenth"] as const).find((level) => JSON.stringify(budgetFor(meta.policy.budget, level)) === JSON.stringify(grant.budget)) ?? "custom";
      }
      const replacementId = !installedId && itemsRef.current.some((item) => item.id === preview.package.manifest.id && !item.hostTrusted) ? preview.package.manifest.id : undefined;
      setReview({ preview, installedId, replacementId, grants: initial, resourceIds, fields, methods, destinations, budgetLevels, budgets, durations, themeScopes: installedId ? [...(items.find((item) => item.id === installedId)?.themeScopes ?? [])] : [...(preview.package.manifest.theme?.requests ?? [])] });
    } catch (error) { setNote(errText(error)); }
    finally { setBusy(false); }
  };
  const inspectFile = async (file?: File): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 8_000_000) throw new Error("Package files are limited to 8 MB.");
      await inspect(JSON.parse(await file.text()));
    } catch (error) { setNote(errText(error)); setBusy(false); }
  };
  const applyReview = async (): Promise<void> => {
    if (!review) return;
    const { preview } = review;
    let grants: ExtensionGrant[];
    try { grants = preview.package.manifest.requirements.filter((req) => review.grants[req.operation] && !preview.unsupported.includes(req.operation)).map((req) => {
      const operation = operationById.get(req.operation);
      return { operation: req.operation,
        resources: resourcesFor(req.operation, req.resources, review.resourceIds),
        fields: review.fields[req.operation] ?? [...req.fields], methods: review.methods[req.operation] ?? [], destinations: review.destinations[req.operation] ?? [], duration: review.durations[req.operation] ?? "session", budget: review.budgetLevels[req.operation] === "custom" && review.budgets[req.operation] ? review.budgets[req.operation]! : budgetFor(operation?.policy.budget ?? "metadata", review.budgetLevels[req.operation] ?? "full") };
    }); } catch (error) { setNote(errText(error)); return; }
    const requiredMissing = preview.package.manifest.requirements.some((req) => req.required && !review.grants[req.operation]);
    if (requiredMissing) { setNote("Approve every required operation or discard this review."); return; }
    if (preview.package.manifest.requirements.some((req) => review.grants[req.operation] && req.methods.length > 0 && !(review.methods[req.operation]?.length))) { setNote("Select at least one allowed request method for every granted network operation."); return; }
    if (preview.package.manifest.requirements.some((req) => review.grants[req.operation] && req.destinations.length > 0 && !(review.destinations[req.operation]?.length))) { setNote("Select at least one allowed destination for every granted operation that requests one."); return; }
    setBusy(true); setNote("");
    try {
      if (review.installedId) await ctx.api.extensions.setGrants(review.installedId, preview.challenge, grants, review.themeScopes, preview.expectedRevision);
      else await ctx.api.extensions.install(preview.challenge, grants, review.themeScopes, preview.expectedRevision);
      invalidateRun(preview.package.manifest.id);
      setReview(null); await refresh(); setNote(review.replacementId ? "Package updated after access review. It remains disabled until you enable it." : "Extension review applied. New installations remain disabled until you enable them.");
    } catch (error) { setNote(errText(error)); }
    finally { setBusy(false); }
  };
  const mutate = async (id: string, revision: number, action: "enable" | "disable" | "revoke"): Promise<void> => {
    invalidateRun(id);
    setRendered((current) => { const next = { ...current }; delete next[id]; return next; });
    setBusy(true); setNote("");
    try { await ctx.api.extensions[action](id, revision); setRendered((current) => { const next = { ...current }; delete next[id]; return next; }); await refresh(); }
    catch (error) { setNote(errText(error)); }
    finally { setBusy(false); }
  };
  const uninstall = async (): Promise<void> => {
    const target = uninstallTarget;
    if (!target) return;
    setBusy(true); setNote("");
    try {
      if (!await ctx.api.extensions.uninstall(target.id, target.revision)) throw new Error("The extension could not be removed. Refresh and retry.");
      invalidateRun(target.id); setRendered((current) => { const next = { ...current }; delete next[target.id]; return next; });
      setUninstallTarget(null); await refresh(); setNote("Extension and its private data were removed.");
    } catch (error) { setNote(errText(error)); }
    finally { setBusy(false); }
  };
  const activate = async (item: InstalledExtensionSummary, kind: "command" | "event", contributionId: string, input: JsonValue): Promise<void> => {
    const epoch = runEpochs.current.get(item.id) ?? 0;
    try { const result = await ctx.api.extensions.activate(item.id, kind, contributionId, input); if ((runEpochs.current.get(item.id) ?? 0) === epoch) setRendered((current) => ({ ...current, [item.id]: { digest: item.digest, result } })); }
    catch (error) { setNote(errText(error)); }
  };
  const answerEffect = async (id: string, approved: boolean): Promise<void> => {
    setBusy(true);
    try { await ctx.api.extensions.answerEffect(id, approved); await refreshPending(); }
    catch (error) { setNote(errText(error)); await refreshPending(); }
    finally { setBusy(false); }
  };
  const answerHostAction = async (ticket: PendingExtensionHostAction, answer: ExtensionHostActionAnswer): Promise<void> => {
    setBusy(true);
    try { await ctx.api.extensions.answerHostAction(ticket.id, answer); await refreshPending(); }
    catch (error) { setNote(errText(error)); await refreshPending(); }
    finally { setBusy(false); }
  };
  const runHostAction = async (ticket: PendingExtensionHostAction): Promise<void> => {
    const item = itemsRef.current.find((candidate) => candidate.id === ticket.packageId);
    if (!item?.enabled || item.digest !== ticket.principal.packageDigest || !item.grants.some((grant) => grant.operation === ticket.operation)) {
      await ctx.api.extensions.answerHostAction(ticket.id, { status: "cancelled" }).catch(() => false);
      await refreshPending();
      return;
    }
    setBusy(true); setNote("");
    try {
      const result = await runExtensionHostActionGesture(ticket, ctx.api.extensions, {
        now: Date.now,
        clipboard: typeof navigator === "undefined" ? undefined : navigator.clipboard,
        openLink: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
        openScene: async (sceneId, ticketId) => {
          const loaded = waitForSceneHandoff(ticketId);
          handOffScene(sceneId, ticketId);
          ctx.openApp(SCENES_APP);
          if (!await loaded) throw new Error("The scene page did not confirm it loaded; the runtime will mark navigation unconfirmed.");
        },
        openEditor: async (kind, entityId) => { const entity = await ctx.api.getEntitySummary(kind, entityId); if (!entity) throw new Error("This library item is no longer available."); ctx.workbench.open(entity); },
        previewRegex: runExtensionRegexPreview,
        runSceneRegex: runExtensionSceneTurnRegex,
        applyComposerDraft: async (ticket) => {
          const loadId = `extension-draft:${ticket.id}`;
          const loaded = waitForSceneHandoff(loadId);
          handOffScene(ticket.sceneId, ticket.id, loadId);
          ctx.openApp(SCENES_APP);
          if (!await loaded) return { status: "composer-draft-result", result: "stale" };
          return { status: "composer-draft-result", result: await replaceComposerDraft(ticket.sceneId, ticket.text) ? "applied" : "stale" };
        },
        music: sharedMusic,
        acquireMusic: () => { musicRelease.current ??= sharedMusic.acquire(); },
        releaseMusic: () => { musicRelease.current?.(); musicRelease.current = null; },
        groups: musicLibrary.groups,
      });
      if (result.message) setNote(result.message);
      await refreshPending();
    } catch (error) { setNote(errText(error)); await refreshPending(); }
    finally { setBusy(false); }
  };
  const answerFileAction = async (ticket: PendingExtensionFileAction): Promise<void> => {
    setBusy(true); setNote("");
    try { await answerExtensionFileAction(ticket, fileRegistry.current!, ctx.api.extensions); await refreshPending(); }
    catch (error) {
      if (ticket.action !== "write" && ticket.action !== "read") await ctx.api.extensions.answerFileAction(ticket.id, { status: "cancelled" }).catch(() => false);
      setNote(errText(error)); await refreshPending();
    }
    finally { setBusy(false); }
  };
  const previewPrompt = async (): Promise<void> => {
    if (!promptSceneId) return;
    setPromptBusy(true); setNote(""); setPromptPreview(null);
    try { setPromptPreview(await ctx.api.extensions.previewPrompts(promptSceneId, promptDraft)); }
    catch (error) { setNote(errText(error)); }
    finally { setPromptBusy(false); }
  };
  return <section className={`${styles.manager} host-protected`} aria-labelledby="extensions-heading">
    <ProtectedLine>Installed extensions can request only the operations shown in each review. Their panels and actions use host-rendered controls and stop when access is disabled or revoked.</ProtectedLine>
    <h3 id="extensions-heading">Extensions</h3>
    <section className={styles.promptPreview} aria-label="Local extension prompt preview">
      <h4>Local prompt preview</h4>
      <p>The host assembles a stored scene and draft, then runs enabled prompt hooks in QuickJS. No model is called, and the preview is unshaped and unbudgeted.</p>
      <label>Stored scene
        <Select value={promptSceneId} disabled={promptBusy || promptScenes.length === 0} onChange={(event) => { setPromptSceneId(event.currentTarget.value); setPromptPreview(null); }}>
          {promptScenes.map(/* bounded-ok: manager API caps scene picker at 500 */ (scene) => <option key={scene.id} value={scene.id}>{scene.title || scene.id} | {scene.id}</option>)}
        </Select>
      </label>
      {promptScenes.length === 0 && <p>No stored scenes are available for preview.</p>}
      <label>Draft message
        <Textarea maxLength={256_000} rows={4} value={promptDraft} disabled={promptBusy} onChange={(event) => { setPromptDraft(event.currentTarget.value); setPromptPreview(null); }} />
      </label>
      <Button size="sm" disabled={promptBusy || !promptSceneId} onClick={() => void previewPrompt()}>{promptBusy ? "Building local preview..." : "Preview prompt hooks"}</Button>
      {promptPreview && <div className={styles.output} aria-label={promptPreview.label}><p>{promptPreview.label}</p><pre>{JSON.stringify(promptPreview.messages, null, 2)}</pre></div>}
    </section>
    {hostActions.notices.map(/* bounded-ok: host action snapshot caps notices at 20 */ (notice) => {
      const owner = items.find((item) => item.id === notice.packageId);
      if (!owner?.enabled || owner.digest !== notice.principal.packageDigest) return null;
      return <p className={styles.notice} key={notice.id}><strong>{owner.name}</strong>: {notice.text}</p>;
    })}
    {hostActions.actions.filter((ticket) => ticket.action !== "playback.status").map(/* bounded-ok: shared host action queue caps outstanding actions at eight */ (ticket) => {
      const owner = items.find((item) => item.id === ticket.packageId);
      const current = !!owner?.enabled && owner.digest === ticket.principal.packageDigest && owner.grants.some((grant) => grant.operation === ticket.operation);
      const title = operationById.get(ticket.operation)?.title ?? ticket.operation;
      return <section className={styles.confirmation} key={ticket.id} aria-label="Extension host action">
        <h4>{ticket.action === "ui.dialog.request" ? `${owner?.name ?? ticket.packageId} asks` : `Extension action: ${title}`}</h4>
        <p><strong>{owner?.name ?? ticket.packageId}</strong> | {title}</p>
        {ticket.action === "clipboard.read" && <p>Read the current clipboard text into this extension, up to 64 KiB.</p>}
        {ticket.action === "clipboard.write" && <><p>Write this exact text to the clipboard ({new TextEncoder().encode(ticket.text).byteLength} bytes).</p><pre className={styles.output}>{ticket.text}</pre></>}
        {ticket.action === "links.open" && <p>Open this reviewed HTTPS destination: <code>{ticket.url}</code></p>}
        {ticket.action === "ui.dialog.request" && <p>{ticket.message}</p>}
        {ticket.action === "ui.scene.open" && <p>Open scene <code>{ticket.sceneId}</code> in the Scenes app.</p>}
        {ticket.action === "ui.editor.open" && <p>Open library item <code>{ticket.kind}:{ticket.entityId}</code> in its editor.</p>}
        {ticket.action === "regex.preview" && <><p>Run {ticket.rules.length} rule(s) for phase <code>{ticket.phase}</code> in the isolated regex worker.</p><pre className={styles.output}>{ticket.text.slice(0, 2_000)}{ticket.text.length > 2_000 ? "\n... input truncated for display" : ""}</pre><ul>{ticket.rules.map(/* bounded-ok: host action contract caps regex preview at 32 rules */ (rule) => <li key={rule.id}><code>{rule.find}</code> -&gt; <code>{rule.replace}</code></li>)}</ul></>}
        {ticket.action === "scene-turn.regex" && <p>Run {ticket.rules.length} rule(s) over {ticket.items.length} scene messages in the isolated regex worker before the reviewed provider request continues. The worker has a hard execution deadline.</p>}
        {ticket.action === "composer.draft.set" && <><p>Replace the current draft for scene <code>{ticket.sceneId}</code>. This will not send it.</p><pre className={styles.output}>{ticket.text}</pre></>}
        {ticket.action === "playback.play" && <p>Play a local audio asset from pack {ticket.packId}.</p>}
        {!current && <p>This action is stale because the package is disabled or its access changed.</p>}
        {ticket.action === "ui.dialog.request"
          ? <div className={styles.actions}><Button size="sm" variant="primary" disabled={busy || !current} onClick={() => void answerHostAction(ticket, { status: "accepted" })}>Continue</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => void answerHostAction(ticket, { status: "declined" })}>Decline</Button></div>
          : ticket.action === "composer.draft.set"
            ? <div className={styles.actions}><Button size="sm" variant="primary" disabled={busy || !current} onClick={() => void runHostAction(ticket)}>Apply to composer</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => void answerHostAction(ticket, { status: "composer-draft-result", result: "declined" })}>Decline</Button></div>
            : ticket.action === "scene-turn.regex"
            ? <div className={styles.actions}><Button size="sm" variant="primary" disabled={busy || !current} onClick={() => void runHostAction(ticket)}>Run scene regex</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => void answerHostAction(ticket, { status: "cancelled" })}>Cancel turn regex</Button></div>
            : <Button size="sm" variant="danger" disabled={busy || !current || ticket.action === "playback.play" && !musicLibrary.groups.some((group) => group.packId === ticket.packId && group.tracks.some((track) => track.sha === ticket.assetId))} onClick={() => void runHostAction(ticket)}>{ticket.action === "clipboard.read" ? "Read clipboard" : ticket.action === "clipboard.write" ? "Copy reviewed text" : ticket.action === "links.open" ? "Open reviewed link" : ticket.action === "ui.scene.open" ? "Open scene" : ticket.action === "ui.editor.open" ? "Open editor" : ticket.action === "regex.preview" ? "Run isolated preview" : ticket.action === "playback.play" ? "Play local track" : ticket.action === "playback.pause" ? "Pause music" : "Stop music"}</Button>}
      </section>;
    })}
    {pendingEffects.map(/* bounded-ok: ticket queue is capped at 8 by the host confirmation owner */ (ticket) => {
      const operation = operationById.get(ticket.operation);
      const writeReview = fileWriteEffectReviewSchema.safeParse(ticket.review);
      const writeTicket = writeReview.success ? pendingFileActions.find((item): item is Extract<PendingExtensionFileAction, { action: "write" }> => item.action === "write" && item.id === writeReview.data.ticketId) : undefined;
      const ownsWriteHandle = !!writeTicket && hasLocalHandle(fileRegistry.current!, writeTicket);
      return <section className={styles.confirmation} key={ticket.id} aria-label="Extension effect approval">
        <h4>Confirm an extension action</h4><p><strong>{ticket.packageName}</strong> requests {operation?.title ?? ticket.operation} ({ticket.effect}).</p>
        {ticket.resources.length > 0 && <p>Targets: {ticket.resources.map(/* bounded-ok: ticket schema caps targets at 64 */ (item) => `${item.kind}: ${item.id}`).join(" | ")}</p>}
        {ticket.fields.length > 0 && <p>Fields: {ticket.fields.join(" | ")}</p>}
        {ticket.methods.length > 0 && <p>Methods: {ticket.methods.join(", ")}</p>}
        {ticket.destinations.length > 0 && <p>Destinations: {ticket.destinations.map(/* bounded-ok: ticket schema caps destinations at 64 */ safeDestination).join(" | ")}</p>}
        <EffectReview value={ticket.review} />
        <p>Expires {new Date(ticket.expiresAt).toLocaleTimeString()}.</p>
        <div className={styles.actions}>{writeTicket ? <Button size="sm" variant="danger" disabled={busy || !ownsWriteHandle} onClick={() => void answerFileAction(writeTicket)}>Review and write file</Button> : <Button size="sm" variant={ticket.effect === "write" || ticket.effect === "external" || ticket.effect === "control" ? "danger" : "primary"} disabled={busy} onClick={() => void answerEffect(ticket.id, true)}>Approve this action</Button>}<Button size="sm" variant="quiet" disabled={busy} onClick={() => void answerEffect(ticket.id, false)}>Deny</Button></div>
        {writeTicket && !ownsWriteHandle && <p>This file handle is available only in the window that selected it.</p>}
      </section>;
    })}
    {pendingFileActions.filter((ticket) => ticket.action !== "write").map(/* bounded-ok: host file action queue is capped at 8 */ (ticket) => {
      const local = ticket.action === "pick" || hasLocalHandle(fileRegistry.current!, ticket);
      return <section className={styles.confirmation} key={ticket.id} aria-label="Extension file action">
      <h4>{ticket.action === "pick" ? "Choose a file for an extension" : ticket.action === "read" ? "Read a chosen file" : "Review a file before writing"}</h4>
      <p><strong>{ticket.packageName}</strong> | {ticket.action === "pick" ? "Choose a file or create one through the native picker." : "File: " + ticket.fileName}</p>
      {ticket.action === "read" && <p>The entire selected file may be returned to this extension, up to {ticket.maxBytes} bytes.</p>}
      {ticket.action === "preview-write" && <p>Review the current file before approving a write.</p>}
      {!local && <p>This file handle is available only in the window that selected it.</p>}
      <div className={styles.actions}><Button size="sm" disabled={busy || !local} onClick={() => void answerFileAction(ticket)}>{ticket.action === "pick" ? "Choose file" : ticket.action === "read" ? "Read file" : "Review file"}</Button><Button size="sm" variant="quiet" disabled={busy || !local} onClick={() => void ctx.api.extensions.answerFileAction(ticket.id, { status: "cancelled" }).then(() => refreshPending())}>Cancel</Button></div>
    </section>; })}
    <label className={styles.import}>Review a package file <Input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void inspectFile(file); }} /></label>
    {loading && <p role="status">Loading installed extensions...</p>}
    {!loading && !items.length && <p>No extensions are installed.</p>}
    <ul className={styles.catalog} aria-label="Installed extensions">{items.map(/* bounded-ok: installed extension store/control listing has a bounded record count */ (item) => {
      const saved = rendered[item.id];
      const result = saved?.digest === item.digest && item.enabled ? saved.result : null;
      const descriptor = descriptorOf(result);
      const output = result && "output" in result ? result.output : null;
      const status = hostActions.statuses.find((value) => value.packageId === item.id && value.principal.packageDigest === item.digest);
      const panels = item.enabled ? hostActions.panels.filter((panel) => panel.packageId === item.id && panel.principal.packageDigest === item.digest && panel.digest === item.digest && item.contributions.some((entry) => entry.type === "panel" && entry.id === panel.contributionId)) : [];
      return <li key={item.id}>
      <div className={styles.title}><strong>{item.name}{item.hostTrusted ? " | Built-in" : ""}</strong><span>v{item.version} | {item.enabled ? "enabled" : "disabled"}{item.recoveryRequired ? " | access review required" : ""}</span></div>
      <p>{item.description}</p><code>{item.id} | SHA-256 {item.digest}</code>
      {item.grants.length ? <div><p>Granted operations and scopes</p><ul className={styles.scopes}>{item.grants.map(/* bounded-ok: package grants are capped at 256 */ (grant) => <li key={grant.operation}>
        <strong>{operationById.get(grant.operation)?.title ?? grant.operation}</strong><span>{grant.duration}; {grant.budget.requests} requests, {grant.budget.bytes} bytes, {grant.budget.tokens} tokens</span>
        {grant.resources.length > 0 && <span>Targets: {grant.resources.map(/* bounded-ok: grant schema caps resources at 256 */ (resource) => `${resource.kind}: ${resource.id}`).join(" | ")}</span>}
        {grant.fields.length > 0 && <span>Fields: {grant.fields.join(" | ")}</span>}
        {grant.methods.length > 0 && <span>Methods: {grant.methods.join(", ")}</span>}
        {grant.destinations.length > 0 && <span>Destinations: {grant.destinations.map(/* bounded-ok: grant schema caps destinations at 64 */ safeDestination).join(" | ")}</span>}
      </li>)}</ul></div> : <p>No operations granted</p>}
      {(item.promptFailures.length > 0 || item.suspendedPromptIds.length > 0) && <p role="status">Prompt hooks: {item.promptFailures.map((failure) => `${failure.id} failed ${failure.count} times`).concat(item.suspendedPromptIds.map((id) => `${id} suspended after 3 failures`)).join("; ")}. Re-enable this extension to clear prompt failure status.</p>}
      <p>Private data: {item.dataBytes} bytes across {item.dataKeys.length} keys</p>
      {!item.hostTrusted && <ExtensionSettingsEditor key={`${item.id}:${item.digest}`} id={item.id} packageName={item.name} enabled={item.enabled} recoveryRequired={item.recoveryRequired} canWrite={item.enabled && !item.recoveryRequired && item.grants.some((grant) => grant.operation === "settings.update")} api={ctx.api.extensions} />}
      {item.theme && <p>Appearance access: {item.themeScopes.length ? item.themeScopes.map((scope) => scope.replaceAll(".", " ")).join(" | ") : "none"}</p>}
      <Disclosure open={activityOpen[item.id] ?? false} label="Recent activity" summary={`${item.activity.length} ${item.activity.length === 1 ? "receipt" : "receipts"}`} onClick={() => setActivityOpen((current) => ({ ...current, [item.id]: !current[item.id] }))} />
      {activityOpen[item.id] && <ul className={styles.activity}>{item.activity.map(/* bounded-ok: service exposes at most 20 redacted receipts per package */ (receipt) => <li key={receipt.id}>
        <strong>{operationById.get(receipt.operation)?.title ?? receipt.operation}</strong><span>{receipt.status} | {receipt.resourceCount} targets | {new Date(receipt.createdAt).toLocaleString()}</span>
      </li>)}</ul>}
      <div className={styles.actions}>
        <Button size="sm" disabled={busy} onClick={() => void inspect(undefined, item.id)}>Review access</Button>
        <Button size="sm" disabled={busy || item.recoveryRequired} onClick={() => void mutate(item.id, item.revision, item.enabled ? "disable" : "enable")}>{item.enabled ? "Disable" : "Enable"}</Button>
        <Button size="sm" variant="danger" disabled={busy || !item.grants.length && !item.themeScopes.length} onClick={() => void mutate(item.id, item.revision, "revoke")}>Revoke access</Button>
        {!item.hostTrusted && <Button size="sm" variant="danger" disabled={busy} onClick={() => setUninstallTarget(item)}>Remove extension</Button>}
      </div>
      {item.enabled && registeredCommands(item).map(/* bounded-ok: package manifest caps contributions at 64 */ (entry) => <Button key={entry.id} size="sm" disabled={busy} onClick={() => void activate(item, "command", entry.id, null)}>{entry.label}</Button>)}
      {status?.text && <p className={styles.status}><strong>Status</strong> | {status.text}</p>}
      {panels.map(/* bounded-ok: package manifest caps contributions at 64 */ (panel) => <div key={`${panel.digest}:${panel.contributionId}`} className={styles.panel} aria-label={`${item.name} panel`}><strong>{item.name}</strong><ExtensionRenderer packageId={item.id} packageName={item.name} descriptor={panel.descriptor} assets={panelAssets[panelKey(item.id, panel.digest, panel.contributionId)]} declaredCommands={registeredCommands(item).map(/* bounded-ok: package manifest caps contributions at 64 */ (entry) => entry.id)} disabled={busy} onCommand={(command, input) => void activate(item, "command", command, input)} /></div>)}
      {descriptor && <ExtensionRenderer key={`${item.id}:${item.digest}:${runEpochs.current.get(item.id) ?? 0}`} packageId={item.id} packageName={item.name} descriptor={descriptor} assets={panelAssets[panelKey(item.id, item.digest, "$activation")]} declaredCommands={registeredCommands(item).map(/* bounded-ok: package manifest caps contributions at 64 */ (entry) => entry.id)} disabled={busy} onCommand={(command, input) => void activate(item, "command", command, input)} />}
      {output !== null && <pre className={styles.output}>{JSON.stringify(output, null, 2)}</pre>}
    </li>; })}</ul>
    {review && <div className={styles.review} aria-label="Extension access review">
      <h4>{review.replacementId ? "Update review" : "Review"} {review.preview.package.manifest.name} v{review.preview.package.manifest.version}</h4><p>{review.preview.package.manifest.description}</p>
      {review.replacementId && <p>This package ID is already installed. Applying this review replaces its package digest, clears its existing grants, and leaves it disabled.</p>}
      <code>{review.preview.package.manifest.id} | SHA-256 {review.preview.digest}</code>
      {review.preview.package.manifest.theme && <div className={styles.requirement}><strong>Appearance access</strong>{review.preview.package.manifest.theme.requests.map(/* bounded-ok: canonical appearance scope enum contains at most 9 entries */ (scope) => <label key={scope}><Checkbox checked={review.themeScopes.includes(scope)} disabled={busy} onChange={(event) => setReview({ ...review, themeScopes: event.currentTarget.checked ? [...review.themeScopes, scope] : review.themeScopes.filter((item) => item !== scope) })} />{scope.replaceAll(".", " ")}</label>)}</div>}
      {review.preview.package.manifest.requirements.map(/* bounded-ok: package manifest caps requirements at 256 */ (requirement) => { const meta = operationById.get(requirement.operation); const unsupported = review.preview.unsupported.includes(requirement.operation); return <div className={styles.requirement} key={requirement.operation}>
        <label><Checkbox checked={review.grants[requirement.operation] ?? false} disabled={requirement.required || unsupported || busy} onChange={(event) => setReview({ ...review, grants: { ...review.grants, [requirement.operation]: event.currentTarget.checked } })} />
          <strong>{meta?.title ?? requirement.operation}</strong> {unsupported ? "Unavailable on this host" : requirement.required ? "Required" : "Optional"}</label>
        {meta && <p>{meta.description} | {meta.effect}, {meta.sensitivity}</p>}
        <p>Package purpose: {requirement.purpose}</p>
        {requirement.fields.length > 0 && <fieldset className={styles.methodList}><legend>Allowed fields</legend>{requirement.fields.map(/* bounded-ok: package schema caps each field list at 128 */ (field) => <label key={field}><Checkbox checked={(review.fields[requirement.operation] ?? []).includes(field)} disabled={busy || unsupported} onChange={(event) => setReview({ ...review, fields: { ...review.fields, [requirement.operation]: event.currentTarget.checked ? [...(review.fields[requirement.operation] ?? []), field] : (review.fields[requirement.operation] ?? []).filter((item) => item !== field) } })} />{field}</label>)}</fieldset>}
        {requirement.methods.length > 0 && <fieldset className={styles.methodList}><legend>Allowed request methods</legend>{requirement.methods.map(/* bounded-ok: package schema caps each method list at five */ (method) => <label key={method}><Checkbox checked={(review.methods[requirement.operation] ?? []).includes(method)} disabled={busy || unsupported} onChange={(event) => setReview({ ...review, methods: { ...review.methods, [requirement.operation]: event.currentTarget.checked ? [...(review.methods[requirement.operation] ?? []), method] : (review.methods[requirement.operation] ?? []).filter((item) => item !== method) } })} />{method}</label>)}</fieldset>}
        {requirement.destinations.length > 0 && <fieldset className={styles.methodList}><legend>Allowed destinations</legend>{requirement.destinations.map(/* bounded-ok: each requirement caps destinations at 64 */ (destination) => <label key={destination}><Checkbox checked={(review.destinations[requirement.operation] ?? []).includes(destination)} disabled={busy || unsupported} onChange={(event) => setReview({ ...review, destinations: { ...review.destinations, [requirement.operation]: event.currentTarget.checked ? [...(review.destinations[requirement.operation] ?? []), destination] : (review.destinations[requirement.operation] ?? []).filter((item) => item !== destination) } })} />{safeDestination(destination)}</label>)}</fieldset>}
        {meta && review.grants[requirement.operation] && <label>Session budget
          <Select value={review.budgetLevels[requirement.operation] ?? "full"} onChange={(event) => setReview({ ...review, budgetLevels: { ...review.budgetLevels, [requirement.operation]: event.currentTarget.value as Review["budgetLevels"][string] } })}>
            <option value="full">Host maximum: {EXTENSION_BUDGET_PRESETS[meta.policy.budget].requests} requests, {EXTENSION_BUDGET_PRESETS[meta.policy.budget].bytes} bytes, {EXTENSION_BUDGET_PRESETS[meta.policy.budget].tokens} tokens</option>
            <option value="half">Half of host maximum</option><option value="tenth">One tenth of host maximum</option>
            {review.budgetLevels[requirement.operation] === "custom" && <option value="custom">Current: {review.budgets[requirement.operation]?.requests ?? 0} requests, {review.budgets[requirement.operation]?.bytes ?? 0} bytes, {review.budgets[requirement.operation]?.tokens ?? 0} tokens</option>}
          </Select></label>}
        {review.grants[requirement.operation] && <label>Grant duration
          <Select value={review.durations[requirement.operation] ?? "session"} onChange={(event) => setReview({ ...review, durations: { ...review.durations, [requirement.operation]: event.currentTarget.value as ExtensionGrant["duration"] } })}>
            <option value="session">This session</option><option value="persistent">Until revoked</option>
          </Select></label>}
        {review.grants[requirement.operation] && requirement.resources.map(/* bounded-ok: each requirement caps resource kinds at 64 */ (kind) => <label key={kind}>Allowed {kind} IDs (comma separated)
          <Input maxLength={2_000} placeholder="resource id, resource id" value={review.resourceIds[`${requirement.operation}:${kind}`] ?? ""} onChange={(event) => setReview({ ...review, resourceIds: { ...review.resourceIds, [`${requirement.operation}:${kind}`]: event.currentTarget.value } })} /></label>)}
      </div>; })}
      {previewHasReadAndEgress(review) && <p className={styles.disclosure}>Combined access: this extension may send content read from the selected targets to an approved external destination. Review the target, fields, and destination above.</p>}
      <div className={styles.actions}><Button size="sm" variant="primary" disabled={busy} onClick={() => void applyReview()}>{review.installedId ? "Apply access review" : review.replacementId ? "Approve and update" : "Approve and install"}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => setReview(null)}>Deny</Button></div>
    </div>}
    {uninstallTarget && <DialogCore placement="center" ariaLabel="Remove extension" onDismiss={() => { if (!busy) setUninstallTarget(null); }}>
      <div className={styles.review}><h3>Remove {uninstallTarget.name}?</h3><p>This removes the package, its private settings and data, and its extension activity records. Library content is not changed.</p>
        <div className={styles.actions}><Button size="sm" variant="danger" disabled={busy} onClick={() => void uninstall()}>{busy ? "Removing..." : "Remove extension and data"}</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => setUninstallTarget(null)}>Keep extension</Button></div>
      </div>
    </DialogCore>}
    {note && <p role="status">{note}</p>}
  </section>;
}

const section: SettingsSection = { id: "extensions", label: "Extensions", order: 20, act: "house", title: "Installed extensions", lede: "Review packages, permissions and host-rendered contributions.", protectedNote: "Extension controls and approval reviews are protected host interfaces.", Component: ExtensionManager };
export default section;
