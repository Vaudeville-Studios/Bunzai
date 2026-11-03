/** Strict saved Promptbook run decoding for attachment provenance. */
import { expect, test } from "bun:test";
import { readBookRun } from "./promptbook-run";

const phase = { id: "p", name: "Write", role: "reply", status: "ran", why: "selected", text: "done", request: ["prompt"], files: [{ message: 0, name: "brief.pdf", kind: "pdf", owner: "Reference" as const }] } as const;

test("saved attachment metadata uses the shared strict bounded contract and request indices", () => {
  expect(readBookRun({ status: "complete", phases: [phase] })?.phases[0]?.files).toEqual([phase.files[0]]);
  for (const file of [
    { ...phase.files[0], message: 1 },
    { ...phase.files[0], name: "../brief.pdf" },
    { ...phase.files[0], extra: true },
    { ...phase.files[0], owner: "o".repeat(256) },
  ]) expect(readBookRun({ status: "complete", phases: [{ ...phase, files: [file] }] })).toBeUndefined();
  expect(readBookRun({ status: "complete", phases: [{ ...phase, files: Array.from({ length: 33 }, () => phase.files[0]) }] })).toBeUndefined();
});
