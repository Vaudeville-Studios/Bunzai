/**
 * Every content kind is wired everywhere a kind must be, or is listed below with the reason it is not. A new kind that
 * misses a part fails here with the file to create, so the hub (src/entities/<kind>/kind.ts) cannot be half-plugged.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS } from "../generated/kinds";
import { ENTITY_SCHEMAS } from "../generated/kind-schemas";
import { EDITOR_VIEWS } from "../ui/apps/workbench/editors";
import { kindProblems } from "./_shared/kind-descriptor";

const ROOT = join(import.meta.dir, "..", "..");
const at = (...parts: string[]): string => join(ROOT, ...parts);

/** Kinds without a Workbench editor, and why. */
const NO_EDITOR: Record<string, string> = {
  promptformat: "nothing reads prompt formats until text-completion connections exist; it opens read-only",
};
/** Kinds without Kit capabilities, and why. */
const NO_CAPABILITIES: Record<string, string> = {
  quickreply: "Kit makes quick-reply sets with its create tool; editing them is the Workbench's",
  dice: "a dice piece is a short piece; Kit reads and writes it through its piece tools",
  formula: "a formula is one macro expression; Kit reads and writes it through its piece tools",
  tracker: "a tracker is a short piece; Kit reads and writes it through its piece tools",
  agent: "Kit uses generic piece operations; Agent authoring is owned by the Workbench editor",
};

describe("every kind is wired everywhere", () => {
  const tokens = readFileSync(at("src", "ui", "theme", "tokens.css"), "utf8");
  for (const kind of KINDS) {
    test(kind.id, () => {
      const missing: string[] = [];
      missing.push(...kindProblems(kind, kind.id));
      for (const file of ["schema.ts", "runtime-schema.ts"]) {
        if (!existsSync(at("src", "entities", kind.id, file))) missing.push(`create src/entities/${kind.id}/${file}`);
      }
      if (!ENTITY_SCHEMAS.some((s) => s.shape.kind.value === kind.id)) missing.push(`run bun run kinds (no decoder for ${kind.id})`);
      if (!existsSync(at("docs", "reference", "entities", `${kind.id}.md`))) missing.push(`write docs/reference/entities/${kind.id}.md`);
      if (!existsSync(at("scripts", "scale", "fixtures", `${kind.id}.ts`))) missing.push(`write scripts/scale/fixtures/${kind.id}.ts`);
      if (!kind.editor && !NO_EDITOR[kind.id]) missing.push(`name its editor in src/entities/${kind.id}/kind.ts (or a reason to NO_EDITOR here)`);
      if (kind.editor && !EDITOR_VIEWS[kind.editor.id]) missing.push(`add the "${kind.editor.id}" editor to src/ui/apps/workbench/editors.ts`);
      if (!existsSync(at("src", "entities", kind.id, "capabilities")) && !NO_CAPABILITIES[kind.id]) missing.push(`add src/entities/${kind.id}/capabilities/ (or a reason to NO_CAPABILITIES here)`);
      const token = kind.accent.slice(4, -1);
      if (!tokens.includes(`${token}:`)) missing.push(`${kind.accent} is not a token in src/ui/theme/tokens.css`);
      expect(missing).toEqual([]);
    });
  }

  test("the exemption lists name only real kinds that really lack the part", () => {
    const ids = new Set<string>(KINDS.map((k) => k.id));
    for (const id of Object.keys(NO_EDITOR)) expect(ids.has(id) && !KINDS.find((k) => k.id === id)?.editor).toBe(true);
    // every editor component is one some kind opens in; an orphan is dead code or a kind.ts that forgot it
    const declared = new Set(KINDS.flatMap((k) => (k.editor ? [k.editor.id] : [])));
    expect(Object.keys(EDITOR_VIEWS).filter((id) => !declared.has(id))).toEqual([]);
    for (const id of Object.keys(NO_CAPABILITIES)) expect(ids.has(id) && !existsSync(at("src", "entities", id, "capabilities"))).toBe(true);
  });
});
