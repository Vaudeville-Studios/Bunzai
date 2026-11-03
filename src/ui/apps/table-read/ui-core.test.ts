/** Presentation boundaries keep stale network views out and completed deadlines nonnegative. */
import { expect, test } from "bun:test";
import { newInterview } from "../../../core/table-read/interview";
import { newerView, secondsRemaining } from "./ui-core";

test("a stale request cannot replace a newer field edit, and a timer never goes negative", () => {
  const session = newInterview({ tempo: "deep-dive", connection: { id: "saved", model: "model" }, idea: "A bartender who forgives debts." }, "interview", "card");
  const current = { revision: 12, session, running: false };
  expect(newerView(current, { ...current, revision: 11 })).toBe(current);
  expect(secondsRemaining(1000, 1001)).toBe(0);
});
