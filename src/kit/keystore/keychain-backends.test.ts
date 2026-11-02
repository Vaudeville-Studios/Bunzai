/**
 * The macOS Keychain and Linux Secret Service keystore backends, against fakes of `security` and
 * `secret-tool` that behave like the real tools (exit codes and replace rules included) and record
 * every command, so the tests can prove the key only travels over stdin and is never made twice.
 * The real tools run only on their own platforms; that proof belongs to CI's keychain job
 * (scripts/probe-keychain.ts), not to these tests.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keychainAddress } from "./backends/keychain-address";
import { keychainKeyBackend, type Runner } from "./backends/keychain-key";
import { linuxSecretTool } from "./backends/linux-secret";
import { macosKeychainTool } from "./backends/macos-keychain";

interface Call {
  command: string;
  args: readonly string[];
  stdin?: string;
}

/**
 * A fake OS secret store behind the real tool's command line, holding items by account.
 * `security add-generic-password` without -U refuses an existing item with exit 45; `secret-tool
 * store` replaces silently. `delay` holds each command, so calls really overlap. `lock()` hides
 * every item and swallows writes, the way a locked keyring might answer.
 */
function fakeTool(kind: "security" | "secret-tool", opts: { installed?: boolean; serviceRunning?: boolean; delay?: number } = {}) {
  const items = new Map<string, string>();
  let locked = false;
  let unlockOnWrite = false;
  const writing = () => {
    if (unlockOnWrite) locked = unlockOnWrite = false;
  };
  let keyCreates = 0;
  const calls: Call[] = [];
  const account = (args: readonly string[]) => args[args.indexOf(kind === "security" ? "-a" : "account") + 1]!;
  const run: Runner = async (command, args, stdin) => {
    calls.push({ command, args, ...(stdin === undefined ? {} : { stdin }) });
    if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
    if (opts.installed === false) throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
    if (opts.serviceRunning === false) return { code: 1, stdout: "", stderr: "Cannot autolaunch D-Bus without X11" };
    if (kind === "security") {
      if (args[0] === "find-generic-password") {
        const v = locked ? undefined : items.get(account(args));
        return v === undefined ? { code: 44, stdout: "", stderr: "not found" } : { code: 0, stdout: `${v}\n`, stderr: "" };
      }
      if (args[0] === "-i") {
        writing();
        const line = stdin ?? "";
        const acct = / -a (\S+)/.exec(line)![1]!;
        if (items.has(acct) && !/ -U /.test(line)) return { code: 45, stdout: "", stderr: "The specified item already exists in the keychain." };
        if (!locked) items.set(acct, / -w (\S+)/.exec(line)![1]!);
        if (acct === "vault-key") keyCreates++;
        return { code: 0, stdout: "", stderr: "" };
      }
    } else {
      if (args[0] === "lookup") {
        const v = locked ? undefined : items.get(account(args));
        return v === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: v, stderr: "" };
      }
      if (args[0] === "store") {
        writing();
        if (!locked) items.set(account(args), stdin ?? "");
        if (account(args) === "vault-key") keyCreates++;
        return { code: 0, stdout: "", stderr: "" };
      }
    }
    return { code: 2, stdout: "", stderr: "unexpected command" };
  };
  return {
    run,
    calls,
    key: () => items.get("vault-key") ?? null,
    keyCreates: () => keyCreates,
    lock: () => void (locked = true),
    unlock: () => void (locked = false),
    // Locked, answering "not found" to every lookup, until a write shows the unlock prompt and the person accepts it.
    lockUntilWrite: () => void (locked = unlockOnWrite = true),
    plantKey: (value: string) => void items.set("vault-key", value),
    forgetKeyOnly: () => void items.delete("vault-key"),
    wipe: () => items.clear(),
  };
}

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const newHome = () => {
  const h = mkdtempSync(join(tmpdir(), "bunzai-kc-"));
  homes.push(h);
  return h;
};

const cases = [
  { name: "macOS Keychain", tool: macosKeychainTool, kind: "security" as const, platform: "darwin" as const },
  { name: "Linux Secret Service", tool: linuxSecretTool, kind: "secret-tool" as const, platform: "linux" as const },
];

let unique = 0;
for (const c of cases) {
  describe(c.name, () => {
    const backend = (fake: ReturnType<typeof fakeTool>, home = newHome(), platform: NodeJS.Platform = c.platform, id = `test-${++unique}`) =>
      keychainKeyBackend(id, c.name, c.tool, { run: fake.run, platform, home, staleLockMs: 400, heartbeatMs: 50 });
    const lockAt = (home: string, id: string) => {
      mkdirSync(join(home, ".bunzai"), { recursive: true });
      return join(home, ".bunzai", `${id}.lock`);
    };

    test("seals and opens, making the key once and reusing it", async () => {
      const fake = fakeTool(c.kind);
      const b = backend(fake);
      const sealed = await b.seal("the data key", {});
      expect(fake.key()).not.toBeNull();
      expect(await b.open(sealed, {})).toBe("the data key");
      await b.seal("again", {});
      expect(fake.keyCreates()).toBe(1);
    });

    test("two first-time seals at once make one key, and both still open", async () => {
      const fake = fakeTool(c.kind, { delay: 15 });
      const b = backend(fake);
      const [a, z] = await Promise.all([b.seal("first", {}), b.seal("second", {})]);
      expect(fake.keyCreates()).toBe(1);
      expect(await b.open(a, {})).toBe("first");
      expect(await b.open(z, {})).toBe("second");
    });

    test("a locked store is refused, never given a new key", async () => {
      const fake = fakeTool(c.kind);
      const b = backend(fake);
      const sealed = await b.seal("before", {});
      const key = fake.key();
      fake.lock();
      await expect(b.seal("while locked", {})).rejects.toThrow(/unlock it/);
      fake.unlock();
      expect(fake.key()).toBe(key);
      expect(fake.keyCreates()).toBe(1);
      expect(await b.open(sealed, {})).toBe("before");
    });

    test("a locked store that a write unlocks keeps its key: the key is looked up again, never replaced", async () => {
      const fake = fakeTool(c.kind);
      const home = newHome();
      const id = `test-${++unique}`;
      const first = await backend(fake, home, c.platform, id).seal("the only copy", {});
      const key = fake.key();
      fake.lockUntilWrite();
      const second = await backend(fake, home, c.platform, id).seal("after the prompt", {});
      expect(fake.key()).toBe(key);
      expect(fake.keyCreates()).toBe(1);
      expect(await backend(fake, home, c.platform, id).open(first, {})).toBe("the only copy");
      expect(await backend(fake, home, c.platform, id).open(second, {})).toBe("after the prompt");
    });

    test("a locked store is refused even on first use, before any marker exists", async () => {
      const fake = fakeTool(c.kind);
      fake.lock();
      await expect(backend(fake).seal("x", {})).rejects.toThrow(/locked/);
      expect(fake.keyCreates()).toBe(0);
    });

    test("a store that lost only the key, keeping the marker, is refused rather than given a second key", async () => {
      const fake = fakeTool(c.kind);
      const b = backend(fake);
      await b.seal("x", {});
      fake.forgetKeyOnly();
      await expect(b.seal("y", {})).rejects.toThrow(/made before/);
      expect(fake.keyCreates()).toBe(1);
    });

    test("a fully wiped store starts fresh: no dead end", async () => {
      const fake = fakeTool(c.kind);
      const b = backend(fake);
      await b.seal("x", {});
      fake.wipe();
      const sealed = await b.seal("after the wipe", {});
      expect(await b.open(sealed, {})).toBe("after the wipe");
    });

    test("a second Bunzai home sees the same marker, so a locked store is refused there too", async () => {
      const fake = fakeTool(c.kind);
      await backend(fake).seal("x", {});
      fake.lock();
      await expect(backend(fake, newHome()).seal("y", {})).rejects.toThrow(/unlock it/);
      expect(fake.keyCreates()).toBe(1);
    });

    test("a key another process makes while this one waits for the lock is used, not overwritten", async () => {
      const fake = fakeTool(c.kind);
      const home = newHome();
      const id = `test-${++unique}`;
      const lockFile = lockAt(home, id);
      writeFileSync(lockFile, "someone-else");
      const b = backend(fake, home, c.platform, id);
      const pending = b.seal("mine", {});
      const theirs = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=";
      setTimeout(() => {
        fake.plantKey(theirs);
        rmSync(lockFile, { force: true });
      }, 100);
      const sealed = await pending;
      expect(fake.key()).toBe(theirs);
      expect(fake.keyCreates()).toBe(0);
      expect(await b.open(sealed, {})).toBe("mine");
    });

    test("a holder that keeps its lock fresh is never taken over, however long it works", async () => {
      const fake = fakeTool(c.kind);
      const home = newHome();
      const id = `test-${++unique}`;
      const lockFile = lockAt(home, id);
      writeFileSync(lockFile, "slow-holder");
      // The other process is stuck at an unlock prompt for well past the stale limit, but alive.
      const beat = setInterval(() => {
        const now = new Date();
        utimesSync(lockFile, now, now);
      }, 50);
      const pending = backend(fake, home, c.platform, id).seal("mine", {});
      await new Promise((r) => setTimeout(r, 900));
      expect(readFileSync(lockFile, "utf8")).toBe("slow-holder");
      expect(fake.keyCreates()).toBe(0);
      clearInterval(beat);
      fake.plantKey("Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M=");
      rmSync(lockFile, { force: true });
      await pending;
      expect(fake.keyCreates()).toBe(0);
    });

    test("while this process works slowly, it keeps its own lock fresh, so nobody takes it over", async () => {
      const fake = fakeTool(c.kind);
      const home = newHome();
      const id = `test-${++unique}`;
      const lockFile = join(home, ".bunzai", `${id}.lock`);
      const markerAccount = keychainAddress().accounts.marker;
      let enteredMarkerWrite!: () => void;
      let releaseMarkerWrite!: () => void;
      const markerWrite = new Promise<void>((resolve) => { enteredMarkerWrite = resolve; });
      const heldMarkerWrite = new Promise<void>((resolve) => { releaseMarkerWrite = resolve; });
      let markerWriteHeld = false;
      const run: Runner = async (command, args, stdin) => {
        const writesMarker = c.kind === "security"
          ? args[0] === "-i" && stdin?.includes(`-a ${markerAccount} `)
          : args[0] === "store" && args.some((arg, index) => arg === "account" && args[index + 1] === markerAccount);
        if (writesMarker && !markerWriteHeld) {
          markerWriteHeld = true;
          enteredMarkerWrite();
          await heldMarkerWrite;
        }
        return fake.run(command, args, stdin);
      };
      let logicalNow = 0;
      let tick: (() => void) | undefined;
      let intervalMs: number | undefined;
      let cancelled = false;
      const b = keychainKeyBackend(id, c.name, c.tool, {
        run,
        platform: c.platform,
        home,
        staleLockMs: 400,
        heartbeatMs: 50,
        now: () => logicalNow,
        heartbeat: (callback, interval) => {
          tick = callback;
          intervalMs = interval;
          return () => { cancelled = true; };
        },
      });
      const pending = b.seal("slow", {});
      const ages: number[] = [];
      const refreshed: boolean[] = [];
      try {
        await markerWrite;
        const token = readFileSync(lockFile, "utf8");
        logicalNow = statSync(lockFile).mtimeMs;
        expect(token).not.toBe("");
        expect(intervalMs).toBe(50);
        if (!tick) throw new Error("the lock heartbeat was not scheduled");
        for (let i = 0; i < 6; i++) {
          logicalNow += 50;
          const before = statSync(lockFile).mtimeMs;
          const age = logicalNow - before;
          ages.push(age);
          expect(age).toBeLessThan(250);
          tick();
          refreshed.push(statSync(lockFile).mtimeMs > before);
          expect(readFileSync(lockFile, "utf8")).toBe(token);
        }
      } finally {
        releaseMarkerWrite();
        await pending.catch(() => undefined);
      }
      expect(ages.length).toBeGreaterThan(5);
      expect(Math.max(...ages)).toBeLessThan(250);
      expect(refreshed).toEqual([true, true, true, true, true, true]);
      expect(await b.open(await pending, {})).toBe("slow");
      expect(fake.keyCreates()).toBe(1);
      expect(cancelled).toBe(true);
    });

    test("a lock left behind by a crashed process is taken over once stale", async () => {
      const fake = fakeTool(c.kind);
      const home = newHome();
      const id = `test-${++unique}`;
      const lockFile = lockAt(home, id);
      writeFileSync(lockFile, "crashed");
      const old = (Date.now() - 10_000) / 1000;
      utimesSync(lockFile, old, old);
      const b = backend(fake, home, c.platform, id);
      const sealed = await b.seal("after the crash", {});
      expect(await b.open(sealed, {})).toBe("after the crash");
      expect(existsSync(lockFile)).toBe(false);
    });

    test("a holder whose lock was taken writes no key, and never removes the lock that replaced its own", async () => {
      const fake = fakeTool(c.kind, { delay: 60 });
      const home = newHome();
      const id = `test-${++unique}`;
      const lockFile = lockAt(home, id);
      const pending = backend(fake, home, c.platform, id).seal("x", {});
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(lockFile, "someone-else-now");
      // Settle first: Bun's expect().rejects on a promise still waiting for timers blocks them from firing.
      const outcome = await pending.then(() => null, (error: Error) => error);
      expect(outcome?.message).toMatch(/took over/);
      expect(fake.keyCreates()).toBe(0);
      expect(readFileSync(lockFile, "utf8")).toBe("someone-else-now");
    });

    test("the key only ever travels over stdin, never in a command's arguments or the payload", async () => {
      const fake = fakeTool(c.kind);
      const sealed = await backend(fake).seal("secret", {});
      const key = fake.key()!;
      for (const call of fake.calls) expect(call.args.join(" ")).not.toContain(key);
      expect(fake.calls.some((call) => call.stdin?.includes(key))).toBe(true);
      expect(sealed).not.toContain(key);
    });

    test("available only on its own platform, with the tool installed and its service running", async () => {
      expect(await backend(fakeTool(c.kind)).available()).toBe(true);
      expect(await backend(fakeTool(c.kind), newHome(), "win32").available()).toBe(false);
      expect(await backend(fakeTool(c.kind, { installed: false })).available()).toBe(false);
      if (c.kind === "secret-tool") expect(await backend(fakeTool(c.kind, { serviceRunning: false })).available()).toBe(false);
    });

    test("opening with no stored key throws instead of guessing", async () => {
      const sealed = await backend(fakeTool(c.kind)).seal("x", {});
      await expect(backend(fakeTool(c.kind)).open(sealed, {})).rejects.toThrow(/missing/);
    });

    test("a damaged stored key is refused", async () => {
      const fake = fakeTool(c.kind);
      fake.plantKey("dG9vIHNob3J0");
      await expect(backend(fake).seal("y", {})).rejects.toThrow(/damaged/);
    });
  });
}
