/**
 * The import RECEIPT humanizer - the plain-words voice of journeys/1.2-import-flow.md, rendered
 * server-side so both shells (visual app, future TUI) say identical sentences. Rules: platform names
 * only (never spec tags), "we read / we kept / we saved" voice, every line only when true. This is a
 * RENDERING of what the engine already knows; no format logic lives here.
 */
import { pieceName } from "../core/piece-name";
import type { CanonicalEntity } from "../core/canonical";
import type { CharacterBody } from "../entities/character/schema";
import type { CanonicalLorebook } from "../entities/lorebook/schema";
import type { CanonicalRegexSet } from "../entities/regex/schema";
import { isRecord } from "../core/guards";
import type { ImportedScene } from "../core/scene-import";
import { plural } from "../core/text";
import { kindOf } from "../generated/kinds";

type AnyEntity = CanonicalEntity<string, unknown>;

/** Human platform names per format id (the friendly-name map the import journey called for). */
const FRIENDLY: Record<string, string> = {
  sillytavern: "SillyTavern",
  "sillytavern-lorebook": "SillyTavern",
  risu: "RisuAI",
  "risu-lorebook": "RisuAI",
  rolecall: "RoleCall",
  "rolecall-lorebook": "RoleCall",
  "rolecall-compendium": "RoleCall",
  "rolecall-persona": "RoleCall",
  agnai: "Agnai",
  "agnai-lorebook": "Agnai",
  backyard: "Backyard (legacy)",
  byaf: "Backyard",
  "novelai-lorebook": "NovelAI",
  "vaud-json": "Bunzai",
  "bunzai-promptbook": "Bunzai",
  "bunzai-agent": "Bunzai",
  lumiverse: "Lumiverse",
  "lumiverse-archive": "Lumiverse",
  pygmalion: "Pygmalion",
  janitor: "JanitorAI",
  "janitor-lorebook": "JanitorAI",
  saucepan: "Saucepan",
  "saucepan-lorebook": "Saucepan",
  "sillytavern-regex": "SillyTavern",
  "sillytavern-quickreply": "SillyTavern",
  "sillytavern-promptformat": "SillyTavern",
  "risu-regex": "RisuAI",
  "rolecall-regex": "RoleCall",
  "lumiverse-regex": "Lumiverse",
  "marinara-regex": "Marinara",
  "marinara-lorebook": "Marinara",
  "marinara-preset": "Marinara",
  "sillytavern-preset": "SillyTavern",
  "rolecall-preset": "RoleCall",
  "rolecall-script-sheet": "RoleCall",
  "lumiverse-preset": "Lumiverse",
  "sillytavern-persona": "SillyTavern",
  "sillytavern-chat": "SillyTavern",
  "lumiverse-persona": "Lumiverse",
  "marinara-persona": "Marinara",
  "image-pack": "Media pack",
};

export const friendlyFormat = (formatId: string): string => FRIENDLY[formatId] ?? formatId;

export interface Receipt {
  name: string;
  /** "A character card, made for SillyTavern." */
  kindLine: string;
  /** only-when-true extra lines (embedded book, scripts, privileged) */
  extras: string[];
}

/**
 * @param related - the pieces extracted with the entity (convert.ts readPieces, same pass): the receipt describes
 *   those (a card's book, a preset's regex sets) rather than re-extracting from original.
 */
export function buildReceipt(
  entity: AnyEntity,
  formatId: string,
  related: readonly { kind: string }[] = [],
): Receipt {
  const relatedOf = <T>(kind: string): T[] => related.filter((p) => p.kind === kind) as T[];
  const kindWord = entity.kind === "preset" && (entity.body as { samplerSet?: string }).samplerSet ? "sampler set" : kindOf(entity.kind)?.receiptWord ?? entity.kind;
  const platform = friendlyFormat(formatId);
  const article = /^[aeiou]/i.test(kindWord) ? "An" : "A";
  const extras: string[] = [];

  if (entity.kind === "character") {
    const body = entity.body as CharacterBody;
    const books = relatedOf<CanonicalLorebook>("lorebook");
    if (books.length > 0) {
      const entries = books[0]!.body.entries.length;
      extras.push(
        `It brought its own lorebook (${entries} ${
          entries === 1 ? "entry" : "entries"
        }) - we kept them together.`,
      );
    }
    const b = body.behavior;
    const scriptCount = (b?.regexScripts?.length ?? 0) + (b?.triggerScripts?.length ?? 0);
    if (scriptCount > 0 || b?.virtualScript || b?.backgroundHTML) {
      extras.push("It carries scripts. They are saved as text and will never run unless you put them on the test stage.");
    }
    if (b?.privileged) extras.push("It asks for deep access - we do not grant that.");
  }
  if (entity.kind === "persona") {
    extras.push("That is you, not a character - we shelve it with your personas.");
  }
  if (entity.kind === "preset") {
    const sets = relatedOf<CanonicalRegexSet>("regex");
    if (sets.length > 0) {
      const rules = sets.reduce((n, s) => n + s.body.rules.length, 0);
      extras.push(
        `It bundles ${rules} regex ${rules === 1 ? "script" : "scripts"} - they shelve beside it as their own set.`,
      );
    }
  }

  const name = pieceName(entity.kind, entity.body) || entity.id;

  return { name, kindLine: `${article} ${kindWord}, made for ${platform}.`, extras };
}

/** The receipt for a chat log: what it holds, who it will be a scene with, and what did not map exactly. */
export function buildSceneReceipt(scene: ImportedScene, formatId: string): Receipt {
  const n = scene.body.messages.length;
  const character = scene.body.characterNames[0];
  return {
    name: character ?? "Chat",
    kindLine: `A chat of ${plural(n, "message")}, made for ${friendlyFormat(formatId)}.`,
    extras: [
      `It joins your scenes with ${character ?? "its character"}, once that card is in your library.`,
      ...scene.body.notes,
    ],
  };
}

/** The warm unknown-file line (journey 1.2): states what we DID look for, one next step implied. */
export const UNKNOWN_FILE_MESSAGE =
  "We could not read this one. It is not a card, book, or persona format we know yet. " +
  "We looked for: png, json, charx, lorebook, byaf.";


/**
 * Name a file we RECOGNIZE but cannot import, in plain words. Detection refuses these shapes on
 * purpose (the cross-kind firewall); telling the user "unknown file" about a famous preset reads
 * as a bug, so the refusal says what the file is and what works instead. Tolerant reader: anything
 * unrecognized returns null and the generic line stands.
 */
export function unsupportedShapeLine(text: string | undefined): string | null {
  if (!text) return null;
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(o)) return null;
  // Every ST template file imports for real now (presets, sampler sets, system prompts, reasoning
  // and prompt formats each have a codec), so only another app's library wrapper is named here.
  if (typeof o.type === "string" && "exportedAt" in o && isRecord(o.data)) {
    return `This is a RoleCall library export of a ${o.type}. Bunzai cannot import these yet.`;
  }
  return null;
}
