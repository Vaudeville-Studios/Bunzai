/** @jsxImportSource @opentui/react */
/**
 * App-to-gate integration: confirmed writes visibly pause and resume only after a user choice.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { useTestBunzaiHome } from "../../../scripts/test-home";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settleRender as tick, testRender } from "./test-render";
import type { Session } from "../session";
import { App } from "./app";
import railCommand from "../commands/rail";

/**
 * A fresh-install gate policy, not this machine's.
 *
 * The App mounts the real gate controller, which remembers its mode from `~/.bunzai/gates.json`.
 * Running `/gates full` in the app therefore turned this red: the write stopped confirming, so the
 * prompt this test waits for never appeared - and the failure read as "the gate stopped pausing on
 * writes", which is alarming and was not true. BUNZAI_HOME is the seam the config already reads.
 */
let home = "";
let restoreBunzaiHome: (() => void) | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "bunzai-appgate-"));
  restoreBunzaiHome = useTestBunzaiHome(home);
});
afterAll(async () => {
  try {
    if (home) await rm(home, { recursive: true, force: true });
  } finally {
    restoreBunzaiHome?.();
  }
});

test("a confirmed write pauses in GatePrompt before the session continues", async () => {
  let choice = "";
  const session: Session = {
    async runTurn(_input, history, _onEvent, _signal, gate) {
      const picked = await gate!.requestConfirm!({
        name: "change_apply",
        verdict: {
          access: "write",
          level: "caution",
          reason: "creates or updates a piece",
        },
        peek: {
          title: "change_apply draft-1",
          detail: "draftId: draft-1",
          level: "caution",
          reason: "creates or updates a piece",
        },
        review: {
          draftId: "draft-1",
          target: { kind: "character", id: "aphrodite" },
          changes: [{ label: "name", before: "Aphrodite", after: "Dite" }],
          warningCount: 0,
        },
      });
      choice = picked.type;
      gate!.onChoice?.(picked, "change_apply");
      return history;
    },
    async probe() {},

    async summarise() { return null; },
    async activeProvider() {
      return null;
    },
  };
  const rendered = await testRender(
    <App
      studioName="Studio"
      totalPieces={0}
      decks={[]}
      session={session}
      commands={[]}
      onQuit={() => {}}
      now={() => 1000}
    />,
    { width: 80, height: 24 },
  );
  try {
    await tick(60);
    await rendered.mockInput.typeText("apply it");
    rendered.mockInput.pressEnter();
    await tick(60);
    expect(rendered.captureCharFrame()).toContain("REVIEW CHANGE");
    expect(rendered.captureCharFrame()).toContain("character / aphrodite");
    expect(rendered.captureCharFrame()).toContain("name");
    expect(rendered.captureCharFrame()).toContain("Aphrodite");
    expect(rendered.captureCharFrame()).toContain("Dite");
    expect(rendered.captureCharFrame()).toContain("Apply & save");
    expect(rendered.captureCharFrame()).toContain("Discard");
    expect(choice).toBe("");
    rendered.mockInput.pressKey("y");
    await tick(60);
    expect(choice).toBe("allow-once");
    expect(rendered.captureCharFrame()).not.toContain("GATE");
  } finally {
    await rendered.renderer.destroy();
  }
});

test("App routes inline rail rename keys away from Composer and preserves Gate priority", async () => {
  let choice = "";
  let turns = 0;
  let raiseGate: (() => void) | null = null;
  const session: Session = {
    async runTurn(_input, history, _onEvent, _signal, gate) {
      turns += 1;
      return new Promise<typeof history>((resolve) => {
        raiseGate = () => {
          void gate!.requestConfirm!({
            name: "change_apply",
            verdict: { access: "write", level: "caution", reason: "creates or updates a piece" },
            peek: { title: "change_apply draft-1", detail: "draftId: draft-1", level: "caution", reason: "creates or updates a piece" },
            review: {
              draftId: "draft-1",
              target: { kind: "character", id: "aphrodite" },
              changes: [{ label: "name", before: "Aphrodite", after: "Dite" }],
              warningCount: 0,
            },
          }).then((picked) => {
            choice = picked.type;
            gate!.onChoice?.(picked, "change_apply");
            resolve(history);
          });
        };
      });
    },
    async probe() {},
    async summarise() { return null; },
    async activeProvider() { return null; },
    presets: {
      async list() { return [{ id: "first", kind: "preset", name: "First Preset" } as never]; },
      async read() { return { name: "First Preset", prompts: [{ id: "greeting", name: "Greeting", content: "Hello" }] } as never; },
      async stage() { throw new Error("not staged by this regression"); },
      async commit() { throw new Error("not committed by this regression"); },
      discard() {},
      amendBlock() { return false; },
    },
  };
  const rendered = await testRender(
    <App studioName="Studio" totalPieces={0} decks={[]} session={session} commands={[railCommand]} onQuit={() => {}} now={() => 1000} />,
    { width: 100, height: 28 },
  );
  try {
    await tick();
    await rendered.mockInput.typeText("start");
    rendered.mockInput.pressEnter();
    await tick();
    expect(turns).toBe(1);

    await rendered.mockInput.typeText("/rail first");
    rendered.mockInput.pressEnter();
    await tick();
    rendered.mockInput.pressTab();
    await tick();
    rendered.mockInput.pressKey("t");
    await tick();
    await rendered.mockInput.typeText("X");
    rendered.mockInput.pressEnter();
    await tick();
    expect(rendered.captureCharFrame()).toContain("renaming to First PresetX");
    expect(rendered.captureCharFrame()).toContain("1 pending");
    expect(turns).toBe(1);

    (raiseGate as (() => void) | null)?.();
    await tick();
    expect(rendered.captureCharFrame()).toContain("REVIEW CHANGE");
    expect(choice).toBe("");
    rendered.mockInput.pressKey("y");
    await tick();
    expect(choice).toBe("allow-once");
    expect(turns).toBe(1);
  } finally {
    await rendered.renderer.destroy();
  }
});
