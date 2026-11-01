/** Purpose: verify navigation tickets settle only after the ScenePage reports its load outcome. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { JSDOM } from "jsdom";
import { installDom, type InstalledDom } from "./test-dom";
import { disableVolatileWebStorage, enableVolatileWebStorage } from "./web-storage";
import { completeSceneHandoff, handedScene, handedSceneTicket, handOffScene, reportSceneOpened, waitForSceneHandoff } from "./scene-handoff";

let dom: JSDOM;
let installed: InstalledDom;
beforeAll(() => { installed = installDom(undefined, { url: "http://127.0.0.1:8332/" }); dom = installed.dom; enableVolatileWebStorage(); });
afterAll(() => { disableVolatileWebStorage(); return installed.teardown(); });

test("scene handoff carries its claimed navigation ID and resolves after a successful page load", async () => {
  const loaded = waitForSceneHandoff("ticket-1", 50);
  handOffScene("scene-1", "ticket-1");
  expect(handedScene()).toBe("scene-1");
  expect(handedSceneTicket()).toBe("ticket-1");
  completeSceneHandoff("ticket-1", true);
  await expect(loaded).resolves.toBe(true);
});

test("a failed scene load and a missing page never confirm navigation", async () => {
  const failed = waitForSceneHandoff("ticket-2", 50);
  completeSceneHandoff("ticket-2", false);
  await expect(failed).resolves.toBe(false);
  await expect(waitForSceneHandoff("ticket-3", 1)).resolves.toBe(false);
  expect(dom.window).toBeDefined();
  handOffScene(null);
});

test("a successful ScenePage load only confirms after server accepts its one-use ticket", async () => {
  const loaded = waitForSceneHandoff("load-1", 50), navigation = waitForSceneHandoff("nav-1", 50);
  let call: unknown[] = [];
  reportSceneOpened("scene-1", "nav-1", "load-1", async (...args) => { call = args; return true; });
  await expect(loaded).resolves.toBe(true);
  await expect(navigation).resolves.toBe(true);
  expect(call).toEqual(["scene-1", "nav-1"]);

  const stale = waitForSceneHandoff("stale-nav", 50);
  reportSceneOpened("scene-1", "stale-nav", null, async () => false);
  await expect(stale).resolves.toBe(false);
});
