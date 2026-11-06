/** Owned Chrome startup protocol uses real child streams, loopback readiness and bounded cleanup. */
import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { connectOwnedChrome } from "./driver";

const children: ChildProcess[] = [];
const child = (source: string): ChildProcess => {
  const process = spawn("node", ["-e", source], { stdio: ["ignore", "ignore", "pipe"] });
  children.push(process);
  return process;
};
afterEach(async () => {
  for (const process of children.splice(0)) {
    if (process.pid && process.exitCode === null && process.signalCode === null) {
      process.kill("SIGKILL");
      await new Promise<void>((resolve) => process.once("close", () => resolve()));
    }
  }
});

test("a real delayed child announces its assigned port and accepts only its exact nonce after warming", async () => {
  const process = child(`const http=require('node:http');const started=Date.now();const server=http.createServer((req,res)=>{res.statusCode=Date.now()-started>=3500?200:503;res.end('owned');});server.listen(0,'127.0.0.1',()=>setTimeout(()=>process.stderr.write('DevTools listening on ws://127.0.0.1:'+server.address().port+'/devtools/browser/owned-nonce\\n'),2800));`);
  let attempts = 0, closed = 0;
  const session = await connectOwnedChrome(process, 0, async (endpoint, timeout) => {
    attempts++;
    expect(new URL(endpoint).pathname).toBe("/devtools/browser/owned-nonce");
    const response = await fetch(endpoint.replace("ws:", "http:").replace("/devtools/browser/owned-nonce", "/ready"), { signal: AbortSignal.timeout(Math.ceil(timeout)) });
    if (!response.ok) throw new Error("still warming");
    expect(await response.text()).toBe("owned");
    return { close: async () => { closed++; } };
  });
  expect(attempts).toBeGreaterThan(1);
  await session.close(); await session.close();
  expect(closed).toBe(1);
  expect(process.exitCode !== null || process.signalCode !== null).toBe(true);
}, 10_000);

test("a split endpoint is not attached until its complete line arrives", async () => {
  const process = child(`process.stderr.write('DevTools listening on ws://127.0.0.1:9591/devtools/browser/');setTimeout(()=>process.stderr.write('complete\\n'),100);setInterval(()=>{},1000);`);
  const seen: string[] = [];
  const session = await connectOwnedChrome(process, 9591, async (endpoint) => { seen.push(endpoint); return { close: async () => {} }; });
  expect(seen).toEqual(["ws://127.0.0.1:9591/devtools/browser/complete"]);
  await session.close();
});

test.each([
  "ws://example.test:9591/devtools/browser/nonce", "ws://127.0.0.1:9592/devtools/browser/nonce",
  "ws://user:secret@127.0.0.1:9591/devtools/browser/nonce", "ws://127.0.0.1:9591/devtools/browser/nonce?secret",
  "ws://127.0.0.1:9591/devtools/browser/nonce#secret", "ws://127.0.0.1:9591/devtools/page/nonce",
  "wss://127.0.0.1:9591/devtools/browser/nonce",
])("refuses an unexpected endpoint without connecting: %s", async (endpoint) => {
  const process = child(`process.stderr.write(${JSON.stringify(`DevTools listening on ${endpoint}\n`)});setInterval(()=>{},1000);`);
  let connected = false;
  const error = await connectOwnedChrome(process, 9591, async () => { connected = true; return { close: async () => {} }; }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("unexpected DevTools endpoint");
  expect((error as Error).message).not.toContain("secret");
  expect(connected).toBe(false);
  expect(process.exitCode !== null || process.signalCode !== null).toBe(true);
});

test("early failure is prompt and retains bounded stderr diagnostics", async () => {
  const process = child(`process.stderr.write('x'.repeat(128*1024)+'\\nfixture startup failed\\n',()=>process.exit(7));`);
  const error = await connectOwnedChrome(process, 9591, async () => { throw new Error("must not connect"); }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("fixture startup failed");
  expect((error as Error).message.length).toBeLessThan(66 * 1024);
  expect(process.exitCode).toBe(7);
});

test("a connection acquired after child exit is closed rather than returned", async () => {
  const process = child(`process.stderr.write('DevTools listening on ws://127.0.0.1:9591/devtools/browser/nonce\\n');setTimeout(()=>process.exit(9),100);`);
  let closed = 0, attempts = 0;
  const error = await connectOwnedChrome(process, 9591, async () => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { close: async () => { closed++; } };
  }).then(() => null, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Chrome exited");
  // the late connection is closed when it arrives, which a loaded runner can put well past 250 ms
  // and a runner slow enough that the child is gone before the first attempt has nothing to close.
  for (let waited = 0; closed < attempts && waited < 5000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
  expect(closed).toBe(attempts);
});

test("missing readiness expires at the fixed deadline and reaps only the owned child", async () => {
  const process = child("setInterval(()=>{},1000)");
  const started = performance.now();
  const error = await connectOwnedChrome(process, 9591, async () => { throw new Error("must not connect"); }).then(() => null, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("within 20 seconds");
  expect(performance.now() - started).toBeLessThan(23_000);
  expect(process.exitCode !== null || process.signalCode !== null).toBe(true);
}, 25_000);

test("child exit interrupts a connector that ignores its own timeout", async () => {
  const process = child(`process.stderr.write('DevTools listening on ws://127.0.0.1:9591/devtools/browser/nonce\\n');setTimeout(()=>process.exit(9),100);`);
  const started = performance.now();
  const error = await connectOwnedChrome(process, 9591, () => new Promise<never>(() => {})).then(() => null, (error: unknown) => error);
  expect((error as Error).message).toContain("Chrome exited");
  expect(performance.now() - started).toBeLessThan(1500);
});

test.each([false, true])("the owner bounds a connector that ignores its timeout (late resolution: %s)", async (late) => {
  const process = child(`process.stderr.write('DevTools listening on ws://127.0.0.1:9591/devtools/browser/nonce\\n');setInterval(()=>{},1000);`);
  let disposed = 0;
  const started = performance.now();
  const error = await connectOwnedChrome(process, 9591, () => new Promise<{ close(): Promise<void> }>((resolve) => {
    if (late) setTimeout(() => resolve({ close: async () => { disposed++; } }), 21_000);
  })).then(() => null, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("within 20 seconds");
  expect(performance.now() - started).toBeLessThan(23_000);
  expect(process.exitCode !== null || process.signalCode !== null).toBe(true);
  if (late) { await new Promise((resolve) => setTimeout(resolve, 1200)); expect(disposed).toBe(1); }
}, 25_000);

test("a reaped child with descendant-held stderr is reported as incomplete cleanup", async () => {
  // This owner runs under Node in the public harness; Bun emits child close before inherited pipes drain.
  const parent = `const {spawn}=require('node:child_process');const descendant=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe',2]});process.stderr.write('descendant='+descendant.pid+'\\n');descendant.stdout.once('data',()=>process.exit(7));`;
  const probe = child(`import(${JSON.stringify(new URL("./driver.ts", import.meta.url).href)}).then(async({connectOwnedChrome})=>{
    const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(parent)}],{stdio:['ignore','ignore','pipe']});let descendant,tail='';
    child.stderr.on('data',chunk=>{tail=(tail+chunk.toString()).slice(-1024);const match=/(?:^|\\n)descendant=(\\d+)\\n/.exec(tail);if(match)descendant=Number(match[1]);});
    const timeout=setTimeout(()=>{child.kill('SIGKILL');if(descendant)process.kill(descendant,'SIGKILL');console.error('fixture exceeded cleanup deadline; recovered PID='+descendant);process.exit(1);},4000);
    try{const error=await connectOwnedChrome(child,9591,async()=>{throw Error('must not connect')}).then(()=>null,e=>e);process.stderr.write(JSON.stringify({message:error?.message,code:child.exitCode,destroyed:child.stderr.destroyed}));}
    finally{clearTimeout(timeout);if(!descendant)throw Error('fixture could not recover exact descendant PID');process.kill(descendant,'SIGKILL');}
  }).catch(error=>{console.error(error);process.exitCode=1;});`);
  let output = "";
  probe.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { probe.kill("SIGKILL"); reject(new Error("Node cleanup probe did not close")); }, 6000);
    probe.once("close", () => { clearTimeout(timeout); resolve(); });
  });
  expect(probe.exitCode, output).toBe(0);
  expect(output).toContain("inherited stderr stream still open");
  expect(output).toContain('"code":7,"destroyed":true');
}, 8000);

test("an unavailable executable fails without waiting for readiness", async () => {
  const process = spawn("codex-missing-chrome-fixture-executable", [], { stdio: ["ignore", "ignore", "pipe"] });
  const error = await connectOwnedChrome(process, 9591, async () => { throw new Error("must not connect"); }).then(() => null, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/ENOENT|Executable not found/);
});
