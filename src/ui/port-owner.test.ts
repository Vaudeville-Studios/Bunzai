/** Real loopback identity checks keep launchers from opening another product. */
import { expect, test } from "bun:test";
import { claimPort, runningBunzaiAt } from "./port-owner";

test.each([
  [{ product: "hoplight", version: "1.0" }, false],
  [{ version: "1.0" }, false],
  [{ product: "bunzai", version: "0.1.41" }, true],
  [{ product: "bunzai", version: 1 }, false],
])("identifies the product answering /api/version: %j", async (body, expected) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(body) });
  try {
    expect(await runningBunzaiAt(server.port!)).toBe(expected ? `http://127.0.0.1:${server.port}` : null);
  } finally { await server.stop(true); }
});

test.each(["competitor", "owned"])("CLI claim checks exact newly started instance %s", async (instanceId) => {
  let stopped = 0, closed = 0;
  const responder = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => Response.json({ product: "bunzai", version: "fixture", instanceId }) });
  try {
    const result = await claimPort(responder.port!, 1, () => ({ instanceId: "owned", stop() { stopped++; }, async close() { closed++; } }))
      .then((value) => ({ value, error: null }), (error: Error) => ({ value: null, error }));
    if (instanceId === "owned") { expect(result.value?.port).toBe(responder.port!); expect(stopped).toBe(0); expect(closed).toBe(0); }
    else { expect(result.error).toBeInstanceOf(Error); expect(stopped).toBe(1); expect(closed).toBe(1); }
  } finally { await responder.stop(true); }
});
