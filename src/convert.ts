/**
 * The bundle/link layer that sits above the single-entity adapters: a card is not just a character,
 * it may bundle an embedded lorebook. Converting one end to end means reading the character, pulling
 * any embedded character_book out as a linked canonical Lorebook (knowledgeRefs), then writing the
 * target - re-embedding that lorebook into the target format's own book slot.
 *
 * This is where "extract at the boundary" (import) meets "inline at the boundary" (export): the
 * extraction is format-agnostic (any CCv2/v3 card), the re-embed is the target adapter's job via the
 * EmitContext it receives. Lives here, at the app layer that already wires adapters together, never
 * in the inward-pointing core. Studio inspect/export must compose the same service as the CLI.
 */
import type {
  AdapterInput,
  AdapterOutput,
  CharacterAdapter,
  FormatAdapter,
  PresetAdapter,
} from "./core/adapter";
import { primaryOriginalRaw } from "./core/canonical";
import { buildSerializeReport, serializeReport } from "./core/reports";
import type { CanonicalCharacter } from "./entities/character/schema";
import type { CanonicalLorebook } from "./entities/lorebook/schema";
import type { CanonicalRegexSet } from "./entities/regex/schema";
import {
  parseCanonicalEntity,
  type ParsedCanonicalEntity,
} from "./entities/runtime-schema";

import { extractCharacterBook } from "./formats/_shared/character-book";
import { filterEnabledBooks } from "./core/lore";
import { forFormatKind } from "./core/writing";

export interface ConvertResult {
  out: AdapterOutput;
  /** lorebooks extracted from the source card and linked to the character (0 or 1 for now) */
  lorebooks: CanonicalLorebook[];
}

/**
 * Write a character through a target adapter, re-embedding resolved lorebooks via EmitContext.
 * Omitted lorebooks mean the relationship was not resolved and preserve the adapter's twin. An
 * explicit empty array is authoritative and removes a stale embedded book.
 */
export function emitBundle(
  target: CharacterAdapter,
  entity: CanonicalCharacter,
  lorebooks?: CanonicalLorebook[],
  requestedExtension?: string,
): AdapterOutput {
  const ctx =
    lorebooks !== undefined || requestedExtension
      ? {
          ...(lorebooks !== undefined ? { lorebooks } : {}),
          ...(requestedExtension ? { requestedExtension } : {}),
        }
      : undefined;
  const out = target.fromCanonical(entity, ctx);
  const report = out.report ?? buildSerializeReport(entity, target);
  if (lorebooks === undefined) return { ...out, report };
  const resolvedIds = new Set(lorebooks.map((book) => book.id));
  const omittedRef = entity.body.knowledgeRefs?.some((id) => !resolvedIds.has(id)) ?? false;
  if (!omittedRef) return { ...out, report };
  return {
    ...out,
    report: serializeReport({
      escrowed: report.escrowed,
      dropped: [...report.dropped, "knowledgeRefs"],
      escrowShadowed: report.escrowShadowed,
      warnings: report.warnings,
    }, report.coverage),
  };
}

/** Attach the required serialize report to a non-character adapter output. */
function reportedOutput(
  target: FormatAdapter,
  entity: ParsedCanonicalEntity,
  out: AdapterOutput,
): AdapterOutput {
  const report = out.report ?? buildSerializeReport(entity, target);
  if (target.native || entity.kind !== "preset") return { ...out, report };
  // Foreign preset grammars carry instruction text, not Bunzai's block files. Array-level
  // coverage and codec-owned reports cannot prove that these nested values survived.
  const paths = (prompts: typeof entity.body.prompts | undefined, prefix: string) =>
    prompts?.flatMap((prompt, index) => prompt.attachments?.length ? [`${prefix}.${index}.attachments`] : []) ?? [];
  const dropped = [
    ...paths(entity.body.prompts, "prompts"),
    ...Object.entries(entity.profiles ?? {}).flatMap(([profile, body]) => paths(body.prompts, `profiles.${profile}.prompts`)),
  ];
  if (!dropped.length) return { ...out, report };
  return { ...out, report: serializeReport({
    escrowed: report.escrowed, escrowShadowed: report.escrowShadowed,
    dropped: [...report.dropped, ...dropped],
    warnings: [...report.warnings, `${target.id} does not carry prompt block attachments; use native Bunzai JSON to keep the files.`],
  }, report.coverage) };
}

/**
 * Every canonical piece one file holds: the primary, then the pieces embedded in it (a card's lorebook, a preset's
 * regex sets), each linked from the primary. The one read path for the CLI, Kit, archive and folder imports and the
 * Studio's inspect, so the same file always becomes the same pieces.
 */
export function readPieces(src: FormatAdapter, input: AdapterInput): { entity: ParsedCanonicalEntity; related: ParsedCanonicalEntity[] } {
  const entity = parseCanonicalEntity(src.toCanonical(input));
  if (entity.kind !== src.kind) throw new Error(`convert: ${src.kind} adapter returned the wrong entity kind`);
  if (entity.kind === "character") {
    // Agnai's native MemoryBook extracts through its own override; every CCv3-lineage card uses the shared extractor.
    // The card's embedded copy STAYS: it is the fallback twin emitBundle re-embeds when links were not resolved
    // (convert.test.ts, "preserves the twin"). Never read it as current; the linked book is the live one.
    const book = (src as CharacterAdapter).extractLorebook?.(entity) ?? extractCharacterBook(primaryOriginalRaw(entity.original));
    if (book) entity.body.knowledgeRefs = [book.id];
    return { entity, related: book ? [book] : [] };
  }
  if (entity.kind === "preset") {
    // ST/RC exports ride regex scripts under extensions.regex_scripts; linked like a card's book (behaviorRefs).
    const regex = (src as PresetAdapter).extractRegex?.(entity) ?? null;
    if (regex) entity.body.behaviorRefs = [regex.id];
    return { entity, related: regex ? [regex] : [] };
  }
  return { entity, related: [] };
}

/**
 * Write a piece through a target, embedding the linked pieces its kind carries inside its own file: a card's enabled
 * lorebooks, a preset's regex sets. `linked` undefined means the links were not resolved (a card keeps its embedded
 * twin); an array is authoritative. Returns what could not ride, in words. The one write path for the CLI, Kit's
 * export and the Studio's export.
 */
export function emitPieces(
  target: FormatAdapter,
  entity: ParsedCanonicalEntity,
  linked: readonly ParsedCanonicalEntity[] | undefined,
  requestedExtension?: string,
): { output: AdapterOutput; unattached: string[] } {
  const of = <K extends string>(kind: K) => linked?.filter((p) => p.kind === kind);
  if (target.kind === "character" && entity.kind === "character") {
    const books = of("lorebook") as CanonicalLorebook[] | undefined;
    return { output: emitBundle(target, entity, books && filterEnabledBooks(books), requestedExtension), unattached: [] };
  }
  if (target.kind === "preset" && entity.kind === "preset") {
    // ST and RoleCall carry rows inside the preset file; Lumiverse attaches by preset_id on the script and Marinara not
    // at all, so a target without embedRegex says so rather than writing a field the host ignores.
    const sets = (of("regex") ?? []) as CanonicalRegexSet[];
    const preset = target as PresetAdapter;
    if (sets.length > 0 && preset.embedRegex) return { output: reportedOutput(target, entity, preset.embedRegex(entity, sets)), unattached: [] };
    const reason = `${target.id} does not carry regex rules inside a preset file; export the set alongside it`;
    return { output: reportedOutput(target, entity, preset.fromCanonical(entity)), unattached: sets.map(() => reason) };
  }
  if (entity.kind !== target.kind) throw new Error(`convert: cannot write a ${entity.kind} as ${target.id} (a ${target.kind} format)`);
  return { output: reportedOutput(target, entity, (target.fromCanonical as (e: ParsedCanonicalEntity) => AdapterOutput)(entity)), unattached: [] };
}

/** Whether a target writes a piece's embedded links into its file: every card format takes its lorebooks; a preset format only when it can embed regex sets. */
export const carriesEmbedded = (target: FormatAdapter): boolean =>
  target.kind !== "preset" || typeof (target as PresetAdapter).embedRegex === "function";

/** The output with what could not ride added to its report's warnings, so no caller loses a linked piece silently. */
export function withUnattached(output: AdapterOutput, unattached: readonly string[]): AdapterOutput {
  if (unattached.length === 0 || !output.report) return output;
  const r = output.report;
  return { ...output, report: serializeReport({ escrowed: r.escrowed, dropped: r.dropped, escrowShadowed: r.escrowShadowed, warnings: [...r.warnings, ...unattached] }, r.coverage) };
}

/**
 * Convert one file to another format of the SAME entity kind, carrying embedded pieces across the boundary (a card's
 * lorebook, a preset's regex sets: extract on import, re-embed on export). Cross-kind conversion fails closed.
 */
export function convertFile(
  src: FormatAdapter,
  target: FormatAdapter,
  input: AdapterInput,
  opts?: { requestedExtension?: string },
): ConvertResult {
  const req = opts?.requestedExtension;
  const read = readPieces(src, input);
  // a writing setup converts to a preset format as the preset it sends (core/writing.ts); any other crossing fails closed
  const entity = forFormatKind(read.entity, target.kind) as ParsedCanonicalEntity;
  const related = read.related;
  if (entity.kind !== target.kind) {
    throw new Error(`convert: cannot convert a ${src.kind} to a ${target.kind} (different entity kinds)`);
  }
  const { output, unattached } = emitPieces(target, entity, related, req);
  return { out: withUnattached(output, unattached), lorebooks: related.filter((p): p is CanonicalLorebook => p.kind === "lorebook") };
}
