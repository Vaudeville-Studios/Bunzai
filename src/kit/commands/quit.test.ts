/** Verifies leaving Kit starts after the active composer submit returns. */
import { expect, test } from "bun:test";
import type { CommandContext } from "./command";
import quit from "./quit";

test("/quit defers root teardown until the submit callback has returned", async () => {
  let left = false;
  const context = {
    arg: "",
    commands: [quit],
    decks: [],
    openSettings: () => {},
    openHelp: () => {},
    quit: () => { left = true; },
    probe: () => false,
    doctor: async () => {},
    say: () => {},
    egressSummary: () => "",
    contextPreview: () => "",
  } satisfies CommandContext;

  quit.run(context);
  expect(left).toBe(false);
  await Promise.resolve();
  expect(left).toBe(true);
});
