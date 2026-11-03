/**
 * The hub every content kind plugs into: `src/entities/<kind>/kind.ts` default-exports one of these and `bun run kinds`
 * (scripts/kind-manifest.ts) writes the seams the app reads (src/generated/). Data and pure functions only, because
 * the browser bundle and the server both load it.
 */
import type glyphs from "../../generated/ic-glyphs.json";
import type { Chat, ChatPrompting } from "../../stage/contracts/chat-store";
import type { PresetBody } from "../preset/schema";

/** A glyph id from src/generated/ic-glyphs.json ("lucide:regex"). */
export type GlyphName = keyof typeof glyphs;

/** The scene prompting lists of piece ids (guides, tools, trackers): the names a kind can say links it. */
export type PromptingList = { [K in keyof ChatPrompting]-?: ChatPrompting[K] extends string[] | undefined ? K : never }[keyof ChatPrompting];

/** A body field holding ids of another kind's pieces. `embedded`: export writes those pieces inside this kind's file. */
export interface KindLink { field: string; to: string; label: string; embedded?: boolean; /** Computed references are edited by their kind's editor, never as a flat id array. */ read?(body: unknown): string[] }

/**
 * The editor this kind opens in on the Workbench (the component lives in src/ui/apps/workbench/editors.ts under this id).
 * `load` is how much of the piece it reads: `light` without its pictures, `lore` through the lorebook's own light
 * read, `full` with everything.
 */
export interface KindEditor { id: string; label: string; load: "light" | "lore" | "full" }

export interface KindDescriptor<Id extends string = string, Body = unknown> {
  /** The canonical `kind`, studio folder and entities folder name; lowercase letters only. */
  id: Id;
  /** Display order wherever kinds are listed (lower first). */
  order: number;
  /** Labels: "Preset", "Presets", "set" (four letters or fewer), "regex set" (import receipts), "Prompts and samplers". */
  singular: string;
  plural: string;
  short: string;
  receiptWord: string;
  blurb: string;
  icon: GlyphName;
  /** A var(--deck-*) token from src/ui/theme/tokens.css. */
  accent: string;
  /** Shown as a Library deck (drawings live in HTML View instead). */
  libraryDeck: boolean;
  /** The kind whose Library deck this kind's pieces join (a Script Sheet sits in the Writing deck with presets). */
  deck?: string;
  /** The deck's own name and line when other kinds join it ("Writing", "Presets and Script Sheets"). */
  deckTitle?: string;
  deckBlurb?: string;
  /** Other words search finds this kind by ("sprite pack"). */
  searchWords?: readonly string[];
  /** The blank piece every "New ..." door saves, under `blankId` until the store makes the id unique. */
  blank?: () => Body & { name?: string };
  blankId?: string;
  /** Lines `bunzai inspect` prints for one piece. */
  describe(body: Body): string[];
  links?: readonly KindLink[];
  /** Renames structured references after a keep-both import; flat links are handled by core/links. */
  renameLinks?(body: Body, renamed: ReadonlyMap<string, string>): Body;
  /** The Workbench editor this kind opens in; absent means it opens read-only. */
  editor?: KindEditor;
  /** Where the body keeps the name; absent means `name` (a character's is identity.name). */
  namePath?: readonly string[];
  /** Never read whole (a pack of pictures): duplicate, rename and the Press work on its head and parts only. */
  heavy?: boolean;
  /** false: the Library offers no "New" even with a blank (packs are made in the Workbench). */
  libraryNew?: boolean;
  /** Binary media slots, dotted, `#` any index and `*` any key; storage keeps them as blob references (media-reference.ts). */
  media?: readonly string[];
  /** Include this kind's pictures in the image gallery and art command; non-image media slots are not gallery art. */
  gallery?: true;
  /** The scene field pointing at pieces of this kind; the scene store owns its shape. */
  sceneField?: keyof Chat;
  /** The list in a scene's prompting that links pieces of this kind by id (a tracker's `trackers`, a tool's `tools`); where a piece is linked is read from it. */
  promptingList?: PromptingList;
  /**
   * A writing setup (a kind the scene's Writing slot holds, core/writing.ts): what it sends, as a preset, so the turn,
   * Final Cut and export read every writing kind the one way.
   */
  asPreset?(body: Body): PresetBody;
  /** False for workflows whose phases cannot be represented by one platform preset. */
  presetExports?: boolean;
  /** Why this piece cannot be sent as it is, in words fit to show, or null. Checked when a turn reads it. */
  sendProblem?(body: Body): string | null;
}

export const defineKind = <Id extends string, Body>(kind: KindDescriptor<Id, Body>): KindDescriptor<Id, Body> => kind;

/** The rules a descriptor must meet; the manifest script and the kind tests both run them. */
export function kindProblems(kind: KindDescriptor, folder: string): string[] {
  const out: string[] = [];
  if (kind.id !== folder) out.push(`${folder}/kind.ts: id "${kind.id}" must match its folder name`);
  if (!/^[a-z]+$/.test(kind.id)) out.push(`${folder}/kind.ts: id must be lowercase letters only`);
  if (kind.short.length > 4) out.push(`${folder}/kind.ts: short "${kind.short}" is longer than four letters`);
  if (!/^var\(--deck-[a-z]+\)$/.test(kind.accent)) out.push(`${folder}/kind.ts: accent must be a var(--deck-*) token`);
  if ((kind.blank === undefined) !== (kind.blankId === undefined)) out.push(`${folder}/kind.ts: blank and blankId go together`);
  return out;
}
