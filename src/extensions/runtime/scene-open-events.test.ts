/** A loaded host scene page, never a GET request or navigation intent, produces scene.opened. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../../stage/store/memory/extension-store";
import { digestJson } from "../contracts/value";
import { EXTENSION_BUDGET_PRESETS } from "../contracts/operation";
import { createOperations as createApiOperations } from "../operations/api/describe";
import { createOperations as createEventOperations } from "../operations/events/subscription-operations";
import { createOperations as createUiOperations } from "../operations/ui/operations";
import { createExtensionService } from "./service";
import { createHostActionPort } from "./host-action-port";

const requirements = {
  "ui.scene.open": [{ resources: ["scene"], fields: ["navigation.scene"] }],
  "events.subscribe": [{ resources: ["event", "scene"], fields: ["payload"] }],
  "api.describe": [{ resources: [], fields: [] }],
} as const;
const manifest = (id: string, contributions: unknown[], operations: readonly (keyof typeof requirements)[]) => ({
  schemaVersion: 1 as const, id, version: "1.0.0", name: id, description: "fixture", author: "tests",
  api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
  requirements: operations.map((operation) => ({ operation, ...requirements[operation][0], methods: [], destinations: [], purpose: "host event fixture", required: true })),
  contributions,
});
const commandPackage = {
  manifest: manifest("opener.extension", [{ type: "command", id: "open", label: "Open", operation: "ui.scene.open" }], ["ui.scene.open"]),
  files: { "main.js": 'bunzai.extension.define({commands:{open:()=>bunzai.call("ui.scene.open",{sceneId:"scene-1"})}});' },
};
const listenerPackage = {
  manifest: manifest("listener.extension", [{ type: "panel", id: "watch", title: "Watch", events: ["scene.opened"] }], ["events.subscribe", "api.describe"]),
  files: { "main.js": 'bunzai.extension.define({events:{"scene.opened":()=>bunzai.call("api.describe",{offset:0,limit:1})}});' },
};

test("completed trusted navigation dispatches scene.opened to exact subscribers, excluding the origin", async () => {
  const store = memoryExtensionStore(() => 1);
  const hostActions = createHostActionPort({ now: () => 1, id: () => crypto.randomUUID() });
  const api = createApiOperations({ content: {} as never });
  const eventOperations = createEventOperations({ events: { subscribe: async () => false, unsubscribe: async () => false } } as never);
  const operations = [...createUiOperations({ hostActions } as never), ...eventOperations, ...api];
  const service = createExtensionService({ store, storeId: "fixture", host: "desktop", operations, hostActions, now: () => 1, id: () => crypto.randomUUID() });
  const fence = await service.start();
  const metadata = new Map(operations.map((operation) => [operation.id, operation]));
  const openerGrants = [{ operation: "ui.scene.open", resources: [{ kind: "scene", id: "scene-1" }], fields: ["navigation.scene"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata }];
  const listenerGrants = [
    { operation: "events.subscribe", resources: [{ kind: "event", id: "scene.opened" }, { kind: "scene", id: "scene-1" }], fields: ["payload"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write },
    { operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.metadata },
  ];
  const install = async (input: typeof commandPackage | typeof listenerPackage, grants: typeof openerGrants | typeof listenerGrants) => {
    const preview = await service.preview(input);
    const control = await service.install(preview.challenge, grants, [], preview.expectedRevision);
    return service.enable(control.id, control.revision);
  };
  const listener = await install(listenerPackage, listenerGrants);
  const existing = await store.readControl(listener.id);
  if (!existing) throw new Error("listener control missing");
  expect(await store.compareAndSaveControl({ ...existing, eventSubscriptions: [{ scope: "scene", event: "scene.opened", sceneId: "scene-1" }], revision: existing.revision + 1 }, existing.revision, fence)).toBe("saved");
  await install(commandPackage, openerGrants);
  const activation = service.activate("opener.extension", "command", "open", null);
  let action = (await service.hostActions()).actions[0];
  for (let attempt = 0; !action && attempt < 100; attempt++) {
    await Bun.sleep(5);
    action = (await service.hostActions()).actions[0];
  }
  if (!action) throw new Error("host navigation ticket was not queued");
  expect((await service.claimHostAction(action.id))?.action).toBe("ui.scene.open");
  expect((await store.listReceipts("listener.extension", null, 10)).map((receipt) => receipt.operation)).not.toContain("api.describe");
  expect(await service.notifySceneOpened("scene-2", action.id)).toBe(false);
  expect(await service.notifySceneOpened("scene-1", action.id)).toBe(true);
  expect(await service.notifySceneOpened("scene-1", action.id)).toBe(false);
  expect(await service.answerHostAction(action.id, { status: "completed" })).toBe(true);
  expect(await activation).toMatchObject({ status: "completed", output: { opened: true } });
  expect((await store.listReceipts("listener.extension", null, 10)).map((receipt) => receipt.operation)).toContain("api.describe");
  const openerReceipts = (await store.listReceipts("opener.extension", null, 10)).map((receipt) => receipt.operation);
  expect(openerReceipts).toContain("ui.scene.open");
  expect(openerReceipts).not.toContain("api.describe");
  expect((await service.hostActions()).notices).toEqual([]);
  await service.close();
});
