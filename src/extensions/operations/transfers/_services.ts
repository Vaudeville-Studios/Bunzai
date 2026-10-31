/** Narrow canonical format reader used after the host has selected and read a file handle. */
import type { AdapterInput, AdapterOutput, FormatAdapter } from "../../../core/adapter";
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../../entities/runtime-schema";
import { emitPieces, withUnattached } from "../../../convert";
import type { SerializeReport } from "../../../core/reports";
import type { ResourceRef } from "../../contracts/operation";
import type { ContentKind } from "../../../entities/capabilities/types";

export interface ExtensionTransferServices {
  readCanonical(kind: ContentKind, id: string, scope: readonly ResourceRef[]): Promise<ParsedCanonicalEntity | null>;
}

export interface ExtensionFormatServices {
  list(): readonly ExtensionFormatSummary[];
  describe(formatId: string): ExtensionFormatSummary | null;
  parse(input: AdapterInput): { adapterId: string; label: string; entity: ParsedCanonicalEntity } | null;
  serialize(formatId: string, entity: ParsedCanonicalEntity): { adapterId: string; label: string; bytes: Uint8Array; report: SerializeReport } | null;
}

export interface ExtensionFormatSummary {
  id: string;
  label: string;
  kinds: ContentKind[];
  extensions: string[];
  native: boolean;
}

export function extensionFormatServices(adapters: readonly FormatAdapter[]): ExtensionFormatServices {
  const summaries = new Map<string, ExtensionFormatSummary>();
  for (const adapter of adapters) {
    const item = summaries.get(adapter.id) ?? { id: adapter.id, label: adapter.label, kinds: [], extensions: [], native: adapter.native === true };
    if (!item.kinds.includes(adapter.kind)) item.kinds.push(adapter.kind);
    for (const extension of adapter.outputExtensions) if (!item.extensions.includes(extension)) item.extensions.push(extension);
    summaries.set(adapter.id, item);
  }
  const list = [...summaries.values()].map((item) => ({
    ...item,
    kinds: item.kinds.sort(),
    extensions: item.extensions.sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    list: () => list,
    describe: (formatId) => list.find((item) => item.id === formatId) ?? null,
    parse(input) {
      let best: FormatAdapter | undefined;
      let score = 0;
      for (const adapter of adapters) {
        try {
          const candidate = adapter.detect(input);
          if (candidate > score) { best = adapter; score = candidate; }
        } catch { /* A malformed source cannot make another adapter more trustworthy. */ }
      }
      if (!best || score < 0.5) return null;
      try {
        const entity = parseCanonicalEntity(best.toCanonical(input));
        return { adapterId: best.id, label: best.label, entity };
      } catch { return null; }
    },
    serialize(formatId, entity) {
      const adapter = adapters.find((item) => item.id === formatId && item.kind === entity.kind);
      if (!adapter) return null;
      try {
        const linked = entity.kind === "character" ? entity.body.knowledgeRefs?.length ?? 0
          : entity.kind === "preset" ? entity.body.behaviorRefs?.length ?? 0 : 0;
        const omitted = linked ? [`${linked} linked piece${linked === 1 ? "" : "s"} not included in this single-piece export`] : [];
        const { output } = emitPieces(adapter, entity, undefined);
        const complete = withUnattached(output, omitted);
        const bytes = complete.bytes ?? (complete.text === undefined ? null : new TextEncoder().encode(complete.text));
        return bytes && complete.report ? { adapterId: adapter.id, label: adapter.label, bytes, report: complete.report } : null;
      } catch { return null; }
    },
  };
}
