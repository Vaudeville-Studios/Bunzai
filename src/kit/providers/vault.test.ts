/** Provider-vault round trips and environment fallback against isolated storage. */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../../scripts/test-home";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { vaultPath } from "./config";
import {
  activeProvider,
  readVault,
  removeProvider,
  resolveProviderConfig,
  readSpotifyLink,
  saveProvider,
  writeSpotifyLink,
} from "./vault";

const HOME = join(tmpdir(), `kit-vault-test-${randomUUID()}`);
const UNLOCK = { passphrase: "kit-vault-test-passphrase" };

// DPAPI seals spawn PowerShell (~1s cold); give the write-heavy cases room.
setDefaultTimeout(30000);

let restoreBunzaiHome: (() => void) | undefined;

beforeAll(() => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
});

afterAll(async () => {
  try {
    await rm(HOME, { recursive: true, force: true });
  } finally {
    restoreBunzaiHome?.();
  }
});

describe("vault", () => {
  test("no vault yet reads empty", async () => {
    expect(await readVault(UNLOCK)).toEqual({ providers: [], activeId: null });
  });

  test("save then read returns the provider, and the key is not on disk in the clear", async () => {
    const saved = await saveProvider(
      { kind: "anthropic", model: "claude-opus-4-8", apiKey: "sk-secret-xyz" },
      UNLOCK,
    );
    expect(saved.id).toBeTruthy();

    const active = await activeProvider(UNLOCK);
    expect(active?.kind).toBe("anthropic");
    expect(active?.apiKey).toBe("sk-secret-xyz");

    const raw = await Bun.file(vaultPath()).text();
    expect(raw).not.toContain("sk-secret-xyz");
    expect(raw).not.toContain("anthropic");
  });

  test("a second provider replaces active; remove reassigns it", async () => {
    const first = (await activeProvider(UNLOCK))!;
    const second = await saveProvider(
      { kind: "openai", model: "gpt-4o", apiKey: "sk-two" },
      UNLOCK,
    );
    expect((await activeProvider(UNLOCK))?.id).toBe(second.id);

    await removeProvider(second.id!, UNLOCK);
    expect((await activeProvider(UNLOCK))?.id).toBe(first.id);
  });

  test("with no active provider, resolve falls back to an env var", async () => {
    const prev = process.env.BUNZAI_HOME;
    process.env.BUNZAI_HOME = join(tmpdir(), `kit-vault-env-${randomUUID()}`);
    process.env.ANTHROPIC_API_KEY = "env-key-123";
    try {
      const cfg = await resolveProviderConfig();
      expect(cfg?.apiKey).toBe("env-key-123");
      expect(cfg?.kind).toBe("anthropic");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.BUNZAI_HOME = prev;
    }
  });
});

describe("vault: the Spotify link", () => {
  test("the refresh token is sealed with the vault and survives provider saves and removals", async () => {
    await writeSpotifyLink({ clientId: "c".repeat(32), refreshToken: "spotify-refresh-secret" }, UNLOCK);
    const extra = await saveProvider({ kind: "openai", model: "gpt-4o", apiKey: "sk-three" }, UNLOCK);
    await removeProvider(extra.id!, UNLOCK);
    expect(await readSpotifyLink(UNLOCK)).toEqual({ clientId: "c".repeat(32), refreshToken: "spotify-refresh-secret" });
    const raw = await Bun.file(vaultPath()).text();
    expect(raw).not.toContain("spotify-refresh-secret");
    expect(raw).not.toContain("spotify");
  });

  test("an empty link removes it and leaves the providers alone", async () => {
    await writeSpotifyLink({}, UNLOCK);
    expect(await readSpotifyLink(UNLOCK)).toEqual({});
    expect((await readVault(UNLOCK)).spotify).toBeUndefined();
    expect((await activeProvider(UNLOCK))?.kind).toBe("anthropic");
  });
});
