/** Purpose: verify settings manager requests stay on the authenticated, schema-checked Extensions client. */
import { expect, test } from "bun:test";
import { createExtensionManagerClient, type ExtensionApiRequest } from "./api-client";
import type { PendingExtensionHostAction } from "../../extensions/contracts/host-actions";

test("settings reads and writes use the package id and preserve revision conflicts", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const request: ExtensionApiRequest = async (path, init) => {
    calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return Response.json(path.endsWith("/read")
      ? { schema: { type: "object", properties: { enabled: { type: "boolean" } } }, value: { enabled: true }, revision: 4 }
      : { status: "stale" });
  };
  const api = createExtensionManagerClient(request);
  const settings = await api.readSettings("demo.settings");
  expect(settings).toEqual({ schema: { type: "object", properties: { enabled: { type: "boolean" } } }, value: { enabled: true }, revision: 4 });
  expect(await api.writeSettings("demo.settings", { enabled: false }, settings.revision)).toEqual({ status: "stale" });
  expect(calls).toEqual([
    { path: "/api/extensions/settings/read", body: { id: "demo.settings" } },
    { path: "/api/extensions/settings/write", body: { id: "demo.settings", value: { enabled: false }, expectedRevision: 4 } },
  ]);
});

test("settings read rejects malformed server values", async () => {
  const api = createExtensionManagerClient(async () => Response.json({ schema: { type: "object" }, value: "unexpected", revision: -2 }));
  await expect(api.readSettings("demo.settings")).rejects.toThrow();
});

test("host action claim uses the authenticated route and rejects malformed tickets", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const ticket: PendingExtensionHostAction = { id: "ticket-1", packageId: "demo", principal: { storeId: "store", packageId: "demo", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 3 }, expiresAt: 50_000, action: "clipboard.write", operation: "clipboard.write", text: "copy me" };
  const api = createExtensionManagerClient(async (path, init) => {
    calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return Response.json(ticket);
  });
  expect(await api.claimHostAction(ticket.id)).toEqual(ticket);
  expect(calls).toEqual([{ path: "/api/extensions/claim-host-action", body: { id: ticket.id } }]);
  const malformed = createExtensionManagerClient(async () => Response.json({ ...ticket, principal: { ...ticket.principal, runEpoch: -1 } }));
  await expect(malformed.claimHostAction(ticket.id)).rejects.toThrow();
});

test("file writes require a just-in-time service begin check", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const api = createExtensionManagerClient(async (path, init) => {
    calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    return Response.json({ begun: true });
  });
  expect(await api.beginFileWrite("file-ticket")).toBe(true);
  expect(calls).toEqual([{ path: "/api/extensions/begin-file-write", body: { id: "file-ticket" } }]);
});

test("command activation sends host-selected resources separately from guest input", async () => {
  let call: { path: string; body: unknown } | undefined;
  const api = createExtensionManagerClient(async (path, init) => {
    call = { path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
    return Response.json({ status: "completed", output: null });
  });
  const resources = [{ kind: "character", id: "mira" }];
  await api.activate("demo.extension", "command", "inspect", { limit: 3 }, { resources });
  expect(call).toEqual({ path: "/api/extensions/activate", body: {
    id: "demo.extension", kind: "command", contributionId: "inspect", input: { limit: 3 }, hostContext: { resources },
  } });
  await expect(api.activate("demo.extension", "command", "inspect", null, { resources: [...resources, ...resources] })).rejects.toThrow();
});
