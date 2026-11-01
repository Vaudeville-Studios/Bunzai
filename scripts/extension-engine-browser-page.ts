/** Browser fixture page that exercises the real production adapter against throwaway hosts. */
import { EXTENSION_WIRE_VERSION } from "../src/extensions/contracts/wire";
import { runJavaScriptInWorker } from "../src/sandbox/javascript/run-in-worker";
import { toErrorMessage } from "../src/error-message";

const params = new URL(location.href).searchParams;
const sandboxOrigin = params.get("sandbox") ?? "";
const resultInvocation = { kind: "command" as const, id: "probe.run", input: null, commands: ["probe.run"], events: [] };
const source = "bunzai.extension.define({commands:{'probe.run':()=>({ok:true,fetch:typeof fetch})},events:{}})";
const root = document.body;

void (async () => {
  // Same-page-origin spoof with a forged result and nonce must not settle the real sandbox job.
  const forged = document.createElement("iframe");
  forged.srcdoc = `<script>parent.postMessage({v:1,type:'result',nonce:'forged',value:{forged:true},logs:[]},'*')<${"/"}script>`;
  window.addEventListener("message", (event) => {
    if (event.source === forged.contentWindow && event.data?.type === "result" && event.data?.nonce === "forged") root.dataset.forgedObserved = "true";
  });
  root.append(forged);
  const result = await runJavaScriptInWorker(source, async (request) => ({
    v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: request.args,
  }), { sandboxOrigin, invocation: resultInvocation });
  root.dataset.result = JSON.stringify(result);

  const controller = new AbortController();
  let requestStarted!: () => void;
  let hostSignal: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const cancelled = runJavaScriptInWorker(
    "bunzai.extension.define({commands:{'probe.run':()=>bunzai.call('test.wait')},events:{}})",
    async (request, signal) => {
      hostSignal = signal;
      requestStarted();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: null };
    },
    { sandboxOrigin, invocation: resultInvocation, signal: controller.signal },
  ).then(() => "unexpected success", (error: unknown) => toErrorMessage(error));
  await started;
  controller.abort();
  const error = await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 120));
  root.dataset.cancelled = String(error.includes("CANCELLED") && hostSignal?.aborted === true);
  root.dataset.done = "true";
})().catch((error: unknown) => {
  root.dataset.error = toErrorMessage(error, "unknown browser probe error");
  root.dataset.done = "true";
});
