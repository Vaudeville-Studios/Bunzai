/** Disposable public broker-to-SQLite receipt lifecycle proof; all state is in-memory fixture data. */
import { afterEach, expect, test } from "bun:test";
import { EXTENSION_BUDGET_PRESETS } from "../contracts/operation";
import { createOperations as createStorageOperations } from "../operations/storage/write-operations";
import { createExtensionStorageServices } from "./storage-services";
import { createExtensionService } from "./service";
import { freshDatabase, testCipher } from "../../stage/store/sqlite/test-support";
import type { StageDatabase } from "../../stage/store/sqlite/database";
import { sqliteExtensionStore } from "../../stage/store/sqlite/extension-store";

const databases: StageDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

test("public activation writes once and settles one durable SQLite admitted receipt", async () => {
  let time = 1_000, serial = 0, service: ReturnType<typeof createExtensionService> | undefined;
  const clock = () => ++time;
  const database = freshDatabase(databases), store = sqliteExtensionStore(database, testCipher(), clock);
  const operations = createStorageOperations({ storage: createExtensionStorageServices(store) } as never).filter((operation) => operation.id === "storage.set");
  let mutations = 0, admittedBeforeMutation = false;
  const write = operations[0]!;
  const execute = write.execute;
  write.execute = async (args: unknown, context: never) => {
    admittedBeforeMutation = (await store.listReceipts("example.receipt", null, 10)).some((receipt) => receipt.status === "admitted");
    mutations++; return await execute(args as never, context);
  };
  service = createExtensionService({ store, storeId: "sqlite-receipt-probe", host: "terminal", operations,
    now: clock, id: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`, confirmEffect: async () => true });
  try {
    const fence = await service.start();
    const input = { manifest: { schemaVersion: 1 as const, id: "example.receipt", version: "1.0.0", name: "Receipt probe", description: "fixture", author: "test",
      api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const,
      requirements: [{ operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], purpose: "store one fixture value", required: true }],
      contributions: [{ type: "command" as const, id: "run", label: "Run", operation: "storage.set" }] },
      files: { "main.js": `bunzai.extension.define({commands:{run:()=>bunzai.call("storage.set",{key:"sample",value:{count:1},expectedRevision:-1})}});` } };
    const review = await service.preview(input);
    const installed = await service.install(review.challenge, [{ operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.write }], [], review.expectedRevision);
    await service.enable(installed.id, installed.revision);
    const activation = await service.activate(installed.id, "command", "run", null);
    expect(activation.output).toEqual({ status: "saved", revision: 0 });
    expect(admittedBeforeMutation).toBe(true);
    expect(await store.readData(installed.id, "sample")).toEqual({ value: { count: 1 }, revision: 0 });
    expect(mutations).toBe(1);

    const [receipt] = await store.listReceipts(installed.id, null, 10);
    if (!receipt) throw new Error("the activation did not persist its receipt");
    expect(receipt).toMatchObject({ operation: "storage.set", effect: "write", status: "committed" });
    expect(receipt!.createdAt).toBeGreaterThan(1_000);
    await store.appendReceipt(receipt!, fence);
    await expect(store.appendReceipt({ ...receipt!, status: "admitted" }, fence)).rejects.toThrow("receipt ID was reused");
    await expect(store.appendReceipt({ ...receipt!, status: "ambiguous" }, fence)).rejects.toThrow("receipt ID was reused");
    await expect(store.appendReceipt({ ...receipt!, createdAt: receipt!.createdAt + 1 }, fence)).rejects.toThrow("receipt ID was reused");
    await expect(store.appendReceipt({ ...receipt!, operation: "storage.delete" }, fence)).rejects.toThrow("receipt ID was reused");
    expect(await store.listReceipts(installed.id, null, 10)).toEqual([receipt]);
    expect(mutations).toBe(1);
    expect(await store.readData(installed.id, "sample")).toEqual({ value: { count: 1 }, revision: 0 });
  } finally { await service.close(); }
});
