/** Exercises the trusted host action gesture adapter with isolated browser and player fakes. */
import { expect, test } from "bun:test";
import type { PendingExtensionHostAction } from "../../extensions/contracts/host-actions";
import { createMusicPlayer, type AudioLike } from "../apps/scenes/stage-music-player";
import { runExtensionHostActionGesture } from "./host-action-gesture";

const principal = { storeId: "store", packageId: "demo", packageDigest: "a".repeat(64), grantRevision: 1, runEpoch: 1 };
const base = { id: "ticket", packageId: "demo", principal, expiresAt: 10_000 };
const readTicket = (): Extract<PendingExtensionHostAction, { action: "clipboard.read" }> => ({ ...base, action: "clipboard.read", operation: "clipboard.read" });
const writeTicket = (text: string): Extract<PendingExtensionHostAction, { action: "clipboard.write" }> => ({ ...base, action: "clipboard.write", operation: "clipboard.write", text });
const linkTicket = (url: string): Extract<PendingExtensionHostAction, { action: "links.open" }> => ({ ...base, action: "links.open", operation: "links.open", url });
const sceneTicket = (): Extract<PendingExtensionHostAction, { action: "ui.scene.open" }> => ({ ...base, action: "ui.scene.open", operation: "ui.scene.open", sceneId: "scene-1" });
const draftTicket = (): Extract<PendingExtensionHostAction, { action: "composer.draft.set" }> => ({ ...base, action: "composer.draft.set", operation: "composer.draft.set", sceneId: "scene-1", text: "reviewed draft" });

test("clipboard and link actions run through the clicked host adapter and report typed answers", async () => {
  const answers: unknown[] = [], writes: string[] = [], links: string[] = [];
  const tickets = [{ ...readTicket(), id: "read" }, { ...writeTicket("exact"), id: "write" }, { ...linkTicket("https://example.com/path"), id: "link" }];
  const api = { claimHostAction: async (id: string) => tickets.find((ticket) => ticket.id === id) ?? null, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return true; } };
  const music = createMusicPlayer(() => ({ src: "", loop: false, volume: 1, preload: "none", play: async () => undefined, pause: () => undefined, load: () => undefined, removeAttribute: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined } as AudioLike));
  const ports = { now: () => 1, clipboard: { readText: async () => "copied", writeText: async (text: string) => { writes.push(text); } }, openLink: (url: string) => links.push(url), openScene: () => undefined, openEditor: () => undefined, music, acquireMusic: () => undefined, releaseMusic: () => undefined, groups: [] };
  await expect(runExtensionHostActionGesture(tickets[0]!, api, ports)).resolves.toMatchObject({ status: "completed" });
  await expect(runExtensionHostActionGesture(tickets[1]!, api, ports)).resolves.toMatchObject({ status: "completed" });
  await expect(runExtensionHostActionGesture(tickets[2]!, api, ports)).resolves.toMatchObject({ status: "completed" });
  expect(answers).toEqual([{ status: "read", text: "copied" }, { status: "completed" }, { status: "completed" }]);
  expect(writes).toEqual(["exact"]); expect(links).toEqual(["https://example.com/path"]);
});

test("oversized clipboard input is cancelled and a ticket result delivery failure is reported honestly", async () => {
  const answers: unknown[] = [];
  const tickets = [{ ...readTicket(), id: "read" }, { ...writeTicket("copy"), id: "write" }];
  const api = { claimHostAction: async (id: string) => tickets.find((ticket) => ticket.id === id) ?? null, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return false; } };
  const ports = { now: () => 1, clipboard: { readText: async () => "x".repeat(65_537), writeText: async () => undefined }, openLink: () => undefined, openScene: () => undefined, openEditor: () => undefined,
    music: {} as never, acquireMusic: () => undefined, releaseMusic: () => undefined, groups: [] };
  await expect(runExtensionHostActionGesture(tickets[0]!, api, ports)).resolves.toMatchObject({ status: "cancelled" });
  await expect(runExtensionHostActionGesture(tickets[1]!, api, ports)).resolves.toMatchObject({ status: "unconfirmed" });
  expect(answers).toEqual([{ status: "cancelled" }, { status: "completed" }]);
});

test("scene navigation happens only through a typed host gesture ticket", async () => {
  const opened: string[] = [], answers: unknown[] = [];
  const ticket = sceneTicket();
  const api = { claimHostAction: async (id: string) => id === ticket.id ? ticket : null, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return true; } };
  const ports = { now: () => 1, openLink() {}, openScene: (id: string) => { opened.push(id); }, openEditor() {}, music: {} as never, acquireMusic() {}, releaseMusic() {}, groups: [] };
  await expect(runExtensionHostActionGesture(ticket, api, ports)).resolves.toMatchObject({ status: "completed" });
  expect(opened).toEqual(["scene-1"]);
  expect(answers).toEqual([{ status: "completed" }]);
});

test("a stale displayed action cannot produce a native side effect without a server claim", async () => {
  const writes: string[] = [];
  const api = { claimHostAction: async () => null, answerHostAction: async () => true };
  const ports = { now: () => 1, clipboard: { readText: async () => "", writeText: async (text: string) => { writes.push(text); } }, openLink() {}, openScene() {}, openEditor() {}, music: {} as never, acquireMusic() {}, releaseMusic() {}, groups: [] };
  await expect(runExtensionHostActionGesture(writeTicket("stale"), api, ports)).resolves.toMatchObject({ status: "cancelled" });
  expect(writes).toEqual([]);
});

test("a server claim that no longer exactly matches the displayed ticket cannot trigger an effect", async () => {
  const writes: string[] = [], answers: unknown[] = [];
  const displayed = writeTicket("displayed"), claimed = { ...displayed, text: "changed" };
  const api = { claimHostAction: async () => claimed, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return true; } };
  const ports = { now: () => 1, clipboard: { readText: async () => "", writeText: async (text: string) => { writes.push(text); } }, openLink() {}, openScene() {}, openEditor() {}, music: {} as never, acquireMusic() {}, releaseMusic() {}, groups: [] };
  await expect(runExtensionHostActionGesture(displayed, api, ports)).resolves.toMatchObject({ status: "cancelled" });
  expect(writes).toEqual([]);
  expect(answers).toEqual([{ status: "cancelled" }]);
});

test("a claimed native action that may have started is settled as ambiguous", async () => {
  const writes: string[] = [], answers: unknown[] = [];
  const ticket = writeTicket("uncertain");
  const api = { claimHostAction: async () => ticket, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return true; } };
  const ports = { now: () => 1, clipboard: { readText: async () => "", writeText: async (text: string) => { writes.push(text); throw new Error("native clipboard acknowledgement lost"); } }, openLink() {}, openScene() {}, openEditor() {}, music: {} as never, acquireMusic() {}, releaseMusic() {}, groups: [] };
  await expect(runExtensionHostActionGesture(ticket, api, ports)).resolves.toMatchObject({ status: "unconfirmed" });
  expect(writes).toEqual(["uncertain"]);
  expect(answers).toEqual([{ status: "ambiguous" }]);
});

test("composer draft action applies only through its clicked host ticket and preserves ambiguous failures", async () => {
  const ticket = draftTicket(), answers: unknown[] = [], applied: string[] = [];
  const api = { claimHostAction: async () => ticket, answerHostAction: async (_id: string, answer: unknown) => { answers.push(answer); return true; } };
  const ports = { now: () => 1, openLink() {}, openScene() {}, openEditor() {}, applyComposerDraft: async (action: typeof ticket) => { applied.push(action.text); return { status: "composer-draft-result" as const, result: "applied" as const }; },
    music: {} as never, acquireMusic() {}, releaseMusic() {}, groups: [] };
  await expect(runExtensionHostActionGesture(ticket, api, ports)).resolves.toMatchObject({ status: "completed" });
  expect(applied).toEqual(["reviewed draft"]);
  expect(answers).toEqual([{ status: "composer-draft-result", result: "applied" }]);

  const failedAnswers: unknown[] = [];
  const failedApi = { ...api, answerHostAction: async (_id: string, answer: unknown) => { failedAnswers.push(answer); return true; } };
  await expect(runExtensionHostActionGesture(ticket, failedApi, { ...ports, applyComposerDraft: async () => { throw new Error("composer changed during apply"); } }))
    .resolves.toMatchObject({ status: "unconfirmed" });
  expect(failedAnswers).toEqual([{ status: "ambiguous" }]);
});
