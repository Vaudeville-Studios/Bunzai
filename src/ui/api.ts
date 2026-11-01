/**
 * The local API client - the one door to the engine.
 * Every fetch funnels through apiFetch (session token + non-2xx rejection).
 */
import type { AppContext, InspectArchiveResult, InspectResult, SaveBundleResult, StagedAssetUpload } from "./app-contract";
import { apiFetch, apiFetchJson } from "./_shared/api-fetch";
import { ADAPTER_INPUT_MAX_BYTES } from "../core/adapter-input";
import { readSceneTurn } from "./apps/scenes/scene-turn-stream";
import { readDramaturgStream, refusalOf } from "./apps/scenes/props/dramaturg/dramaturg-stream";
import { isCanonicalMediaReference } from "../entities/_shared/media-reference";
import type { PiecePatch } from "../stage/contracts/content-store";
import { isRecord } from "../core/guards";
import { isSha256Hex } from "../core/sha256";
import { whileBusy } from "./_shared/while-busy";
import { readThemeAssetResponse } from "./shell/theme-asset-urls";
import { createExtensionManagerClient } from "./extensions/api-client";

export { ApiHttpError as ApiError } from "./_shared/api-fetch";

const postJson = <T,>(path: string, body: unknown): Promise<T> =>
  apiFetchJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A streamed file answer: the Response itself, or the server's own words when it refused. */
const streamed = async (path: string, what: string): Promise<Response> => {
  const res = await apiFetch(path, { requireToken: false });
  if (!res.ok) {
    const text = await res.text();
    let message = `could not ${what} (${res.status})`;
    try { const body = JSON.parse(text) as { error?: unknown }; if (typeof body.error === "string") message = body.error; } catch { /* keep the status line */ }
    throw new Error(message);
  }
  return res;
};

const SENTINEL_PREFIX = "\u0000b:";

/** Light reads unescape authored marker literals for editing; actual media refs stay opaque. */
function normalizeLight(value: unknown, kind: string, path: readonly (string | number)[] = []): unknown {
  if (typeof value === "string") {
    const escaped = SENTINEL_PREFIX + SENTINEL_PREFIX;
    return !isCanonicalMediaReference(kind, path) && value.startsWith(escaped) ? value.slice(SENTINEL_PREFIX.length) : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeLight(item, kind, [...path, index]));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeLight(item, kind, [...path, key])]));
  }
  return value;
}

/** Re-escape authored markers on the patch wire; recognized media slots retain active refs. */
function patchWire(kind: string, patch: PiecePatch): PiecePatch {
  const encode = (value: unknown, path: readonly (string | number)[] = []): unknown => {
    if (typeof value === "string") {
      // Canonical authored text is unescaped at this boundary, regardless of how many prefixes it
      // contains. Media slots are still in their light wire form: preserve active refs and escaped
      // literals exactly so storage can resolve or unescape them once.
      return value.startsWith(SENTINEL_PREFIX) && !isCanonicalMediaReference(kind, path)
        ? SENTINEL_PREFIX + value
        : value;
    }
    if (Array.isArray(value)) return value.map((item, index) => encode(item, [...path, index]));
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item, [...path, key])]));
    }
    return value;
  };
  const head = isRecord(patch.head)
    ? { ...patch.head }
    : patch.head;
  if (isRecord(head)) delete head.original;
  return {
    head: encode(head),
    ...(patch.items === undefined ? {} : { items: encode(patch.items) as Record<string, unknown> }),
    ...(patch.order === undefined ? {} : { order: patch.order }),
    ...(patch.original === undefined ? {} : { original: encode(patch.original) as Record<string, unknown> }),
    ...(patch.native === undefined ? {} : { native: {
      ...(patch.native.marinaraFolderParents === undefined ? {} : { marinaraFolderParents: patch.native.marinaraFolderParents }),
      ...(patch.native.risuAdditionalAssets === undefined ? {} : { risuAdditionalAssets: patch.native.risuAdditionalAssets.map(([name, ref, ext]) => [encode(name) as string, ref, encode(ext) as string] as const) }),
    } }),
  };
}

function kindFromQuery(id: string): string {
  return new URLSearchParams(id).get("kind") ?? "";
}

export const api: AppContext["api"] = {
  readExtensionThemeAsset: async (packageId, assetId, themeDigest, assetDigest, mediaType, signal) => {
    if (!/^[a-z0-9.-]{1,120}$/u.test(packageId) || !/^[a-z0-9-]{1,48}$/u.test(assetId) || !isSha256Hex(themeDigest) || !isSha256Hex(assetDigest)) throw new Error("Invalid extension theme asset reference.");
    const response = await apiFetch(`/api/themes/assets/${encodeURIComponent(packageId)}/${encodeURIComponent(assetId)}?digest=${encodeURIComponent(themeDigest)}`, { signal });
    return readThemeAssetResponse(response, { digest: assetDigest, mediaType }, signal);
  },
  extensions: createExtensionManagerClient(apiFetch),
  search: (input, signal) => apiFetchJson("/api/search", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal,
  }),
  listEntities: async (kind) =>
    apiFetchJson(`/api/studio/list${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`, {
      requireToken: false,
    }),
  getEntitySummary: async (kind, id) =>
    apiFetchJson(`/api/studio/summary?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { requireToken: false }),
  studioInventory: async (kind) =>
    apiFetchJson(`/api/studio/inventory${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`, {
      requireToken: false,
    }),
  getEntity: async (query) =>
    whileBusy(() => apiFetchJson(`/api/studio/get?${query}`, { requireToken: false })),
  getEditableEntity: async (id) =>
    whileBusy(() => apiFetchJson(`/api/studio/get?${id}&revision=1`, { requireToken: false })),
  getLightEditableEntity: async (id) => {
    const light = await whileBusy(() => apiFetchJson<import("./app-contract-editor").LightEditableEntity>(`/api/studio/get?${id}&light=1`, { requireToken: false }));
    return { ...light, entity: normalizeLight(light.entity, kindFromQuery(id)) };
  },
  getEditableOriginalEntry: async (kind, id, format) =>
    apiFetchJson(`/api/studio/original?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&format=${encodeURIComponent(format)}`, { requireToken: false }),
  getEditableOriginalEntryVersioned: async (kind, id, format) =>
    apiFetchJson(`/api/studio/original?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&format=${encodeURIComponent(format)}&revision=1`, { requireToken: false }),
  getRisuNamedAssets: async (kind, id) =>
    apiFetchJson(`/api/studio/risu-assets?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { requireToken: false }),
  saveEntity: async (entity, opts) =>
    apiFetchJson("/api/studio/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts?.overwrite ? { entity, overwrite: true } : entity),
    }),
  saveEditedEntity: async (entity, expectedRevision) =>
    apiFetchJson("/api/studio/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity, expectedRevision }),
    }),
  patchEditedEntity: async (kind, id, expectedRevision, patch, uploads, intent = "manual") =>
    postJson("/api/studio/patch", { kind, id, expectedRevision, intent, ...patchWire(kind, patch), ...(uploads?.length ? { uploads } : {}) }),
  adoptAssets: async (refs) => {
    const res = await apiFetch("/api/asset/adopt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assets: refs }) });
    const body = (await res.json().catch(() => null)) as { grants?: StagedAssetUpload[]; error?: unknown } | null;
    if (!res.ok || !body?.grants) throw new Error(typeof body?.error === "string" ? body.error : `Copying the picture failed (${String(res.status)}).`);
    return body.grants;
  },
  spotifyGet: (path) => apiFetchJson(path),
  spotifyPost: (path, body) => postJson(path, body),
  discardAssetUploads: async (refs) => { await postJson("/api/asset/discard", { refs }); },
  uploadAssetFromUrl: async (url, signal) =>
    apiFetchJson("/api/asset/from-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal }),
  uploadAsset: async (file, signal) =>
    apiFetchJson("/api/asset/upload", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
      body: file,
      signal,
    }),
  deleteEntity: async (kind, id) =>
    apiFetchJson("/api/studio/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id }),
    }),
  listTrash: async () => apiFetchJson("/api/studio/trash", { requireToken: false }),
  restoreFromTrash: async (graveId) =>
    apiFetchJson("/api/studio/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graveId }),
    }),
  listScenes: async () => apiFetchJson("/api/chats/list", { requireToken: false }),
  openScene: async (id) => apiFetchJson(`/api/chats/open?id=${encodeURIComponent(id)}`, { requireToken: false }),
  olderSceneMessages: async ({ chatId, branchId, beforeSeq, expectedVersion }) =>
    apiFetchJson(`/api/chats/page?${new URLSearchParams({ id: chatId, branchId, beforeSeq: String(beforeSeq), expectedVersion: String(expectedVersion) })}`, { requireToken: false }),
  searchScene: async (chatId, query) => postJson("/api/chats/search", { chatId, query }),
  getSceneMacroMessages: async ({ chatId, branchId, expectedVersion, indices }) =>
    apiFetchJson(`/api/chats/macro-messages?${new URLSearchParams({ chatId, branchId, expectedVersion: String(expectedVersion), indices: indices.join(",") })}`, { requireToken: false }),
  getSceneSwipe: async ({ chatId, branchId, messageId, index, expectedVersion }) =>
    apiFetchJson(`/api/chats/swipe?${new URLSearchParams({ chatId, branchId, messageId, index: String(index), expectedVersion: String(expectedVersion) })}`, { requireToken: false }),
  getSceneSwipeHistory: async ({ chatId, branchId, messageId, index, expectedVersion }) =>
    apiFetchJson(`/api/chats/swipe-history?${new URLSearchParams({ chatId, branchId, messageId, index: String(index), expectedVersion: String(expectedVersion) })}`, { requireToken: false }),
  startScene: async (characterId) => postJson("/api/chats/start", { characterId }),
  sendToScene: async (input) => postJson("/api/chats/send", input),
  editSceneMessage: async (input) => postJson("/api/chats/edit", input),
  renameScene: async (id, title) => postJson("/api/chats/rename", { id, title }),
  deleteScene: async (id) => postJson("/api/chats/delete", { id }),
  editScene: async (action, input) => postJson(`/api/chats/${action}`, input),
  runSceneTurn: async (input, onEvent) =>
    readSceneTurn(await apiFetch("/api/chats/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), onEvent),
  runSceneDraft: async (input, signal) =>
    apiFetchJson("/api/chats/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), ...(signal ? { signal } : {}) }),
  proposeTrackerItem: async (input, signal) =>
    apiFetchJson("/api/chats/tracker-item", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), ...(signal ? { signal } : {}) }),
  proposeTrackerRefresh: async (input, signal) =>
    apiFetchJson("/api/chats/tracker-refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), ...(signal ? { signal } : {}) }),
  getLinkedScenes: async (kind, id) => apiFetchJson(`/api/chats/linked?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { requireToken: false }),
  getSceneTrackers: async (chatId) => apiFetchJson(`/api/chats/library-trackers?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  editSceneTracker: async (input) => postJson("/api/chats/tracker-edit", input),
  getTrackerChanges: async (branchId, from, to) => apiFetchJson(`/api/chats/tracker-changes?branchId=${encodeURIComponent(branchId)}&from=${encodeURIComponent(from)}${to === undefined ? "" : `&to=${encodeURIComponent(to)}`}`, { requireToken: false }),
  getSceneForecast: async (chatId, draft, signal) =>
    apiFetchJson("/api/chats/forecast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, draft }), ...(signal ? { signal } : {}) }),
  tryFormula: async (chatId, text, signal) =>
    apiFetchJson("/api/chats/formula-try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, text }), ...(signal ? { signal } : {}) }),
  stopSceneTurn: async (chatId, turnId) => postJson("/api/chats/stop", { chatId, turnId }),
  answerSceneReview: async (chatId, turnId, answer) => postJson("/api/chats/review", { chatId, turnId, ...answer }),
  answerSceneRegex: async (chatId, turnId, answer) => postJson("/api/chats/regex-answer", { chatId, turnId, ...answer }),
  keepWaitingReply: async (chatId, turnId) => postJson("/api/chats/add-anyway", { chatId, turnId }),
  discardWaitingReply: async (chatId, turnId) => postJson("/api/chats/discard", { chatId, turnId }),
  setSceneConnection: async (chatId, connection) => postJson("/api/chats/connection", { chatId, connection }),
  setScenePreset: async (chatId, preset) => postJson("/api/chats/preset", { chatId, preset }),
  setScenePrompting: async (chatId, prompting) => postJson("/api/chats/prompting", { chatId, prompting }),
  setSceneRegex: async (chatId, regex) => postJson("/api/chats/regex", { chatId, regex }),
  setSceneFinalCut: async (chatId, finalCut) => postJson("/api/chats/final-cut", { chatId, finalCut }),
  compareTakes: async (chatId, a, b) => apiFetchJson(`/api/chats/compare-takes?chatId=${encodeURIComponent(chatId)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  applyFinalCutRerun: async (chatId, rerunId, expectedVersion) => apiFetchJson("/api/chats/final-cut/rerun/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, rerunId, expectedVersion }) }),
  getFinalCutRun: async (chatId, messageId) => apiFetchJson(`/api/chats/final-cut/run?chatId=${encodeURIComponent(chatId)}&messageId=${encodeURIComponent(messageId)}`),
  rerunFinalCut: async (chatId, messageId, signal) => apiFetchJson("/api/chats/final-cut/rerun", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, messageId }), ...(signal ? { signal } : {}) }),
  getFinalCutLibrary: async () => apiFetchJson("/api/chats/final-cut/library"),
  saveFinalCutBank: async (bank) => postJson("/api/chats/final-cut/library/bank", { bank }),
  deleteFinalCutBank: async (id) => postJson("/api/chats/final-cut/library/bank/delete", { id }),
  saveFinalCutAgent: async (agent) => postJson("/api/chats/final-cut/library/agent", { agent }),
  deleteFinalCutAgent: async (id, revision) => postJson("/api/chats/final-cut/library/agent/delete", { id, revision }),
  setSceneTracker: async (chatId, module, patch) => postJson("/api/chats/trackers", { chatId, module, patch }),
  getTrackerStates: async (chatId) => apiFetchJson(`/api/chats/tracker-state?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  writeTrackerStates: async (input) => postJson("/api/chats/tracker-state", input),
  setSceneCompendium: async (chatId, compendium) => postJson("/api/chats/compendium", { chatId, compendium }),
  setSceneBackdrop: async (chatId, backdrop) => postJson("/api/chats/backdrop", { chatId, backdrop }),
  listGuides: async () => apiFetchJson("/api/chats/guides", { requireToken: false }),
  saveGuide: async (guide) => postJson("/api/chats/guides/save", { guide }),
  deleteGuide: async (id) => postJson("/api/chats/guides/delete", { id }),
  sceneSettings: async (chatId) => apiFetchJson(`/api/chats/settings?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  listLoadouts: async (removed) => apiFetchJson(`/api/chats/loadouts${removed ? "?removed=1" : ""}`, { requireToken: false }),
  saveLoadout: async (loadout) => postJson("/api/chats/loadouts/save", { loadout }),
  deleteLoadout: async (id) => postJson("/api/chats/loadouts/delete", { id }),
  restoreLoadout: async (id) => postJson("/api/chats/loadouts/restore", { id }),
  saveLoadoutReceipt: async (receipt) => postJson("/api/chats/loadouts/receipt", { receipt }),
  finishLoadoutReceipt: async (code, rows) => postJson("/api/chats/loadouts/receipt-finish", { code, rows }),
  markLoadoutReceiptUndone: async (code) => postJson("/api/chats/loadouts/receipt-undone", { code }),
  latestLoadoutReceipt: async (chatId) => apiFetchJson(`/api/chats/loadouts/receipt?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  saveSceneMember: async ({ chatId, member, kind, id, expectedRevision, patch, uploads }) =>
    postJson("/api/chats/save-member", { chatId, member, save: { kind, id, expectedRevision, intent: "manual", ...patchWire(kind, patch), ...(uploads?.length ? { uploads } : {}) } }),
  personaStats: async (personaId) => apiFetchJson(`/api/chats/persona-stats?id=${encodeURIComponent(personaId)}`),
  sceneConnections: async () => apiFetchJson("/api/chats/connections", { requireToken: false }),
  connectionModels: async (id) => apiFetchJson(`/api/chats/models?id=${encodeURIComponent(id)}`, { requireToken: false }),
  listSceneTrash: async () => apiFetchJson("/api/chats/trash", { requireToken: false }),
  restoreSceneGrave: async (kind, id) => postJson(`/api/chats/restore-${kind}`, { id }),
  getSceneLore: async (chatId) => apiFetchJson(`/api/chats/lore?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  setSceneLore: async (chatId, lore) => postJson("/api/chats/lore", { chatId, lore }),
  listCompendiumReceipts: async (chatId, page = {}) => apiFetchJson(`/api/chats/compendium/receipts?chatId=${encodeURIComponent(chatId)}${page.branchId ? `&branchId=${encodeURIComponent(page.branchId)}` : ""}${page.before ? `&before=${encodeURIComponent(page.before)}` : ""}${page.limit ? `&limit=${page.limit}` : ""}`, { requireToken: false }),
  standardizeStatus: async (chatId) => apiFetchJson(`/api/chats/compendium/standardize?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  startStandardize: async (chatId, bookId, request) => postJson("/api/chats/compendium/standardize", { chatId, bookId, ...request }),
  cancelStandardize: async (chatId, bookId) => postJson("/api/chats/compendium/standardize/cancel", { chatId, bookId }),
  dismissStandardize: async (chatId, bookId) => postJson("/api/chats/compendium/standardize/dismiss", { chatId, bookId }),
  revertStandardize: async (chatId, bookId) => postJson("/api/chats/compendium/standardize/revert", { chatId, bookId }),
  undoCompendiumReceipt: async (chatId, receiptId) => postJson("/api/chats/compendium/undo", { chatId, receiptId }),
  fileCompendiumAgain: async (chatId, receiptId) => postJson("/api/chats/compendium/file-again", { chatId, receiptId }),
  clearCompendiumFeed: async (chatId) => postJson("/api/chats/compendium/clear-feed", { chatId }),
  listCompendiumReconcile: async (chatId, bookId) => apiFetchJson(`/api/chats/compendium/reconcile?chatId=${encodeURIComponent(chatId)}&bookId=${encodeURIComponent(bookId)}`, { requireToken: false }),
  reconcileCompendium: async (chatId, bookId, action, pairs) => postJson("/api/chats/compendium/reconcile", { chatId, bookId, action, pairs }),
  getCompendiumTree: async (chatId, bookId) => apiFetchJson(`/api/chats/compendium/tree?chatId=${encodeURIComponent(chatId)}&bookId=${encodeURIComponent(bookId)}`, { requireToken: false }),
  buildCompendiumTree: async (chatId, bookId) => postJson("/api/chats/compendium/tree-build", { chatId, bookId }),
  undoCompendiumTree: async (chatId, bookId) => postJson("/api/chats/compendium/tree-undo", { chatId, bookId }),
  moveCompendiumEntry: async (chatId, bookId, entryId, nodeId) => postJson("/api/chats/compendium/tree-move", { chatId, bookId, entryId, nodeId }),
  getCompendiumIngest: async (chatId) => apiFetchJson(`/api/chats/compendium/ingest?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  startCompendiumIngest: async (chatId, bookId, from, to) => postJson("/api/chats/compendium/ingest-start", { chatId, bookId, from, to }),
  cancelCompendiumIngest: async (chatId, runId) => postJson("/api/chats/compendium/ingest-cancel", { chatId, runId }),
  undoCompendiumIngest: async (chatId, runId) => postJson("/api/chats/compendium/ingest-undo", { chatId, runId }),
  getSceneParticipants: async (chatId) => apiFetchJson(`/api/chats/participants?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  changeSceneParticipants: async (chatId, change) => postJson("/api/chats/participants", { chatId, change }),
  reconcileSceneParticipants: async (chatId, count) => postJson("/api/chats/participants/reconcile", { chatId, count }),
  applySceneParticipants: async (chatId, people) => postJson("/api/chats/participants/apply", { chatId, people }),
  undoSceneParticipants: async (chatId, run) => postJson("/api/chats/participants/undo", { chatId, run }),
  getSceneProps: async (chatId) => apiFetchJson(`/api/chats/props?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  setSceneProps: async (chatId, on) => postJson("/api/chats/props", { chatId, props: { on } }),
  getSceneTrace: async (chatId, messageId) =>
    apiFetchJson(`/api/chats/trace?chatId=${encodeURIComponent(chatId)}${messageId ? `&messageId=${encodeURIComponent(messageId)}` : ""}`, { requireToken: false }),
  getSceneSummary: async (chatId) => apiFetchJson(`/api/chats/summary?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  getCoreSceneState: async (chatId, offset = 0) => apiFetchJson(`/api/chats/core-state?chatId=${encodeURIComponent(chatId)}&offset=${offset}`, { requireToken: false }),
  setCoreSceneFeature: async (chatId, feature, enabled) => postJson("/api/chats/core-settings", { chatId, feature, enabled }),
  setSceneSummarySettings: async (chatId, patch) => postJson("/api/chats/summary-settings", { chatId, patch }),
  saveSceneSummary: async (chatId, text) => postJson("/api/chats/summary", { chatId, text }),
  getSceneDirector: async (chatId, opts) => apiFetchJson(`/api/chats/director?chatId=${encodeURIComponent(chatId)}${opts?.at ? `&at=${encodeURIComponent(opts.at)}` : ""}`, { requireToken: false }),
  editSceneDirector: async (chatId, edit, expectedVersion) => postJson("/api/chats/director-edit", { chatId, edit, expectedVersion }),
  undoSceneTrackerUpdate: async (chatId, module, messageId) => postJson("/api/chats/director-tracker-undo", { chatId, module, messageId }),
  setSceneDirectorSettings: async (chatId, patch) => postJson("/api/chats/director-settings", { chatId, patch }),
  getSceneDramaturg: async (chatId) => apiFetchJson(`/api/chats/dramaturg?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  setSceneDramaturgSettings: async (chatId, patch) => postJson("/api/chats/dramaturg-settings", { chatId, patch }),
  clearSceneDramaturg: async (chatId, revision) => postJson("/api/chats/dramaturg-clear", { chatId, revision }),
  askSceneDramaturg: async (chatId, question, revision, onEvent, signal) => {
    const res = await apiFetch("/api/chats/dramaturg-turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, question, revision }), ...(signal ? { signal } : {}) });
    if (!res.ok) throw await refusalOf(res);
    await readDramaturgStream(res, onEvent);
  },
  stopSceneDramaturg: async (chatId, revision) => { await postJson("/api/chats/dramaturg-stop", { chatId, ...(revision === undefined ? {} : { revision }) }); },
  backfillSceneSummary: async (chatId, signal) =>
    apiFetchJson("/api/chats/summary-backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId }), ...(signal ? { signal } : {}) }),
  summarizeSceneNow: async (chatId, signal) =>
    apiFetchJson("/api/chats/summary-now", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId }), ...(signal ? { signal } : {}) }),
  searchSceneSummaries: async (query) => apiFetchJson(`/api/chats/summary-search?q=${encodeURIComponent(query)}`, { requireToken: false }),
  getSceneVariables: async (chatId) => apiFetchJson(`/api/chats/variables?chatId=${encodeURIComponent(chatId)}`, { requireToken: false }),
  getSceneVariableHistory: async (chatId, scope, key) => apiFetchJson(`/api/chats/variable-history?chatId=${encodeURIComponent(chatId)}&scope=${scope}&key=${encodeURIComponent(key)}`, { requireToken: false }),
  setSceneFavorite: async (id, on) => postJson("/api/chats/favorite", { id, on }),
  listSceneFolders: async () => apiFetchJson("/api/chats/folders", { requireToken: false }),
  createSceneFolder: async (name) => postJson("/api/chats/folders", { name }),
  renameSceneFolder: async (id, name) => postJson("/api/chats/folders/rename", { id, name }),
  deleteSceneFolder: async (id) => postJson("/api/chats/folders/delete", { id }),
  setSceneFolder: async (id, folderId) => postJson("/api/chats/folder", { id, folderId }),
  getSceneTail: async (chatId, n) => apiFetchJson(`/api/chats/tail?id=${encodeURIComponent(chatId)}&n=${n}`, { requireToken: false }),
  saveBundle: async (payload): Promise<SaveBundleResult> =>
    apiFetchJson("/api/studio/save-bundle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  inspectFile: async (file, signal): Promise<InspectResult> => {
    if (file.size > ADAPTER_INPUT_MAX_BYTES) {
      throw new Error("file too large to inspect");
    }
    // Per-request deadline so one dead connection can never freeze a bulk run; the caller's
    // signal (the import sheet's Cancel) composes with it.
    const deadline = AbortSignal.timeout(90_000);
    return apiFetchJson("/api/inspect", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        // HTTP headers are ISO-8859-1 only; an emoji in a filename made fetch itself throw and
        // every import "fail" client-side. Always URI-encode; the server always decodes.
        "x-filename": encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  },
  inspectArchive: async (file, signal): Promise<InspectArchiveResult> =>
    // `body: file` - the browser streams a File straight off disk; unlike inspectFile's
    // `await file.arrayBuffer()`, this never holds a multi-gigabyte backup in JS memory at once.
    // No fixed deadline either: inspectFile's 90s timeout assumes a small file on a live
    // connection, which a real Lumiverse backup's upload time cannot promise - the sheet's own
    // Cancel (the caller's `signal`) is the only abort this needs.
    apiFetchJson("/api/inspect-archive", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-filename": encodeURIComponent(file.name),
      },
      body: file,
      signal,
    }),
  saveStaged: async (payload) =>
    // Tiny by design: a token, a key, and an id map - the staged entity itself never crosses.
    apiFetchJson("/api/studio/save-staged", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  cancelStaged: async (rows) => postJson("/api/studio/cancel-staged", { rows }),
  importCompleted: async (pieceCount) => postJson("/api/studio/import-complete", { pieceCount }),
  exportEntity: async (entity, targetId, extension) =>
    apiFetchJson("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(extension ? { entity, targetId, extension } : { entity, targetId }),
    }),
  saveExportFolder: async (label, files) => {
    const { dir, folder } = await postJson<{ dir: string; folder: string }>("/api/export-folder", { label });
    // One request per file, streamed to disk by the server: a run of big packs is never one body.
    // The server mints each final name ("Vera (2).png" on a clash), so the answer lists those.
    const saved: string[] = [];
    for (const [name, blob] of Object.entries(files)) {
      const { name: savedAs } = await apiFetchJson<{ name: string }>(`/api/export-folder/file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: blob,
      });
      saved.push(savedAs);
    }
    return { dir, files: saved };
  },
  duplicateEntity: async (kind, id) => postJson("/api/studio/duplicate", { kind, id }),
  exportStoredPack: (id) => streamed(`/api/studio/export-pack?id=${encodeURIComponent(id)}`, "print the pack"),
  exportCompendium: (id) => streamed(`/api/studio/export-compendium?id=${encodeURIComponent(id)}`, "export the compendium"),
  collections: async () => apiFetchJson("/api/collections", { requireToken: false }),
  /** Returns the whole file as the server stored it; see the contract for why, not an ack. */
  collectionEdit: async (edit) =>
    apiFetchJson("/api/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edit),
    }),
  formats: async () => apiFetchJson("/api/formats", { requireToken: false }),
  macroEngines: async () => apiFetchJson("/api/macro-lab/engines", { requireToken: false }),
  macroResolve: async (ask) =>
    apiFetchJson("/api/macro-lab/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
    }),
  version: async () => apiFetchJson("/api/version", { requireToken: false }),
  updateCheck: async () => apiFetchJson("/api/update-check", { requireToken: false }),
  updatesReleases: async (page = 1) =>
    apiFetchJson(`/api/updates/releases?page=${page}`, { requireToken: false }),
  switchTo: async (version: string) =>
    apiFetchJson("/api/updates/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    }),
  switchStatus: async () => apiFetchJson("/api/updates/switch-status", { requireToken: false }),
  switchPending: async () => apiFetchJson("/api/updates/pending", { requireToken: false }),
  shutdownApp: async () => apiFetchJson("/api/shutdown", { method: "POST" }),
  restartApp: async () => apiFetchJson("/api/restart", { method: "POST" }),
  coverage: async () => apiFetchJson("/api/coverage", { requireToken: false }),
  remoteStatus: async () => apiFetchJson("/api/remote/status", { requireToken: false }),
  remoteEnable: async () => apiFetchJson("/api/remote/enable", { method: "POST" }),
  remoteDisable: async () => apiFetchJson("/api/remote/disable", { method: "POST" }),
  remoteDevices: async () => apiFetchJson("/api/remote/devices", { requireToken: false }),
  remoteKick: async (nodeId: string) =>
    apiFetchJson("/api/remote/kick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId }),
    }),
  remoteHelperStatus: async () => apiFetchJson("/api/remote/helper/status", { requireToken: false }),
  remoteHelperDownload: async () => apiFetchJson("/api/remote/helper/download", { method: "POST" }),
  remoteLanStatus: async () => apiFetchJson("/api/remote/lan/status", { requireToken: false }),
  remoteLanEnable: async () => apiFetchJson("/api/remote/lan/enable", { method: "POST" }),
  remoteLanDisable: async () => apiFetchJson("/api/remote/lan/disable", { method: "POST" }),
  remoteLanApprove: async (id: string) =>
    apiFetchJson("/api/remote/lan/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  remoteLanDeny: async (id: string) =>
    apiFetchJson("/api/remote/lan/deny", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  remoteLanKick: async (id: string) =>
    apiFetchJson("/api/remote/lan/kick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }),
};
