/** Remote theme reads use only the lifecycle reader; appearance writes remain host-only. */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unifiedThemeService } from "../extensions/theme-test-fixture";
import { StudioStore } from "../studio/store";
import { SettingsStore } from "../studio/settings";
import { createHandler } from "./server";
import { apiReq, filledSec } from "./server-test-rig";
import { isHostOnlyRoute } from "./server-remote";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "vaude-theme-remote-"));
  try { return await fn(dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

describe("remote theme boundary", () => {
  test("approved LAN readers get effective appearance but never lifecycle writes", async () => {
    await withDir(async (dir) => {
      const sec = filledSec();
      const service = await unifiedThemeService();
      const themeReader = { effective: service.themeEffective, asset: service.themeAsset, confirmHealthy: service.themeConfirmHealthy,
        markBroken: service.themeMarkBroken, revisionStamp: service.themeRevision };
      const reads = { opened: () => null, themeReader: async () => themeReader } as Parameters<typeof createHandler>[12];
      const handler = createHandler(new StudioStore(dir), new SettingsStore(dir), undefined, sec,
        undefined, undefined, undefined, undefined, true, undefined, undefined, undefined, reads);
      const response = await handler(apiReq("/api/themes/effective"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ themeId: null, appearance: null, fallbackReason: "not-installed" });
      const revision = await handler(apiReq("/api/themes/revision"));
      expect(revision.status).toBe(200);
      expect(await revision.json()).toMatchObject({ epoch: expect.stringMatching(/^[a-f0-9]{48}$/), revision: 0 });
      const mutation = await handler(apiReq("/api/themes/disable", { method: "POST", token: sec.token, contentType: "application/json", body: JSON.stringify({ id: "theater" }) }));
      expect(mutation.status).toBe(403);
      await service.close();
    });
  });

  test("only safe theme reads are admitted on the guest handler", () => {
    const routes: [string, string, boolean][] = [
      ["/api/themes/effective", "GET", false], ["/api/themes/revision", "GET", false],
      ["/api/themes/events", "GET", true],
      ["/api/themes/assets/paper/mark?digest=x", "GET", false], ["/api/themes/effective", "POST", true],
      ["/api/themes/revision", "POST", true],
      ["/api/themes/install", "POST", true], ["/api/themes/packages", "GET", true],
    ];
    for (const [path, method, hostOnly] of routes) expect(isHostOnlyRoute(path, method)).toBe(hostOnly);
  });
});
