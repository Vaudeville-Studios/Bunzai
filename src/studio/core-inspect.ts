/** Read and configure rp-core Director and Compendium for a linked Bunzai scene. */
import { Engine } from "rp-core";
import type { Entry, MessageView } from "rp-core";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import { isRecord } from "../core/guards";

const PAGE_SIZE = 20;

export interface CoreSceneState {
  directorEnabled: boolean;
  memoryEnabled: boolean;
  director: Record<string, unknown> | null;
  memory: {
    total: number;
    offset: number;
    items: Array<{ ref: string; type: string; name: string; origin: string; retired: boolean; render: string }>;
    queued: number;
    running: boolean;
    parked: number;
  };
}

/** Pick the latest committed Director record on the visible path, not a discarded turn's prep. */
export function directorOnPath(path: readonly MessageView[], entries: readonly Entry[]): Record<string, unknown> | null {
  const onPath = new Set(path.map((message) => message.id));
  const byMessage = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (entry.t !== "msg" && entry.t !== "edit") continue;
    const id = entry.t === "msg" ? entry.id : entry.target;
    if (!onPath.has(id)) continue;
    const record = entry.dir;
    if (isRecord(record) && isRecord(record["state"]) && typeof record["turn"] === "number") byMessage.set(id, record);
  }
  for (let i = path.length - 1; i >= 0; i--) {
    const record = byMessage.get(path[i]!.id);
    if (record) return { turn: record["turn"], ok: record["ok"] === true, state: record["state"], ...(isRecord(record["directive"]) ? { directive: record["directive"] } : {}) };
  }
  return null;
}

export async function readCoreSceneState(records: CoreSceneRecords, home: string, sessionId: string, offset = 0): Promise<CoreSceneState> {
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    const path = (await session.view()).path;
    const header = await session.header();
    let directorEnabled = header.config.director?.enabled === true;
    let memoryEnabled = header.config.compendium?.enabled !== false;
    const entries: Entry[] = [];
    for await (const item of records.read(sessionId)) {
      if (item.t === "session") continue;
      entries.push(item);
      if (item.t === "config" && typeof item.patch.director?.enabled === "boolean") directorEnabled = item.patch.director.enabled;
      if (item.t === "config" && typeof item.patch.compendium?.enabled === "boolean") memoryEnabled = item.patch.compendium.enabled;
    }
    const rows = await session.memoryList();
    const status = await session.memoryStatus();
    const items = [];
    for (const row of rows.slice(offset, offset + PAGE_SIZE)) {
      const detail = await session.memoryGet({ ref: row.ref });
      items.push({ ref: row.ref, type: row.type, name: row.name, origin: row.origin === "session" ? "session" : row.origin.book, retired: row.retired !== undefined, render: detail.render });
    }
    return {
      directorEnabled,
      memoryEnabled,
      director: directorOnPath(path, entries),
      memory: { total: rows.length, offset, items, queued: status.queued.length, running: status.running !== undefined, parked: status.parked.length },
    };
  } finally { await engine.close(); }
}

/** Persist a core feature switch in the session journal; existing memory and Director records remain. */
export async function setCoreSceneFeature(records: CoreSceneRecords, home: string, sessionId: string, feature: "director" | "memory", enabled: boolean): Promise<CoreSceneState> {
  const engine = await Engine.openWithRecordStore({ home, recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    if (feature === "director") await session.configure({ director: { enabled } });
    else await session.configure({ compendium: { enabled } });
  } finally { await engine.close(); }
  return readCoreSceneState(records, home, sessionId);
}
