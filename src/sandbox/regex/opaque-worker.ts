/** Purpose: run the trusted regex worker behind an opaque, no-network Browser frame. */
import { isRecord } from "../../core/guards";

const MAX_WORKER_SOURCE_CHARS = 5_000_000;
const MAX_REQUEST_BYTES = 2_000_000;

function frameHtml(parentOrigin: string, nonce: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">
const P=${JSON.stringify(parentOrigin)},N=${JSON.stringify(nonce)};let worker,url,active=false;const send=(type,extra={})=>parent.postMessage({v:1,type,nonce:N,...extra},'*');
const exact=(o,k)=>o&&typeof o==='object'&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join(',')===k;
const stop=()=>{active=false;worker?.terminate();worker=undefined;if(url){URL.revokeObjectURL(url);url=undefined;}};
addEventListener('message',event=>{const m=event.data;if(event.source!==parent||event.origin!==P||!m||typeof m!=='object'||m.v!==1||m.nonce!==N||typeof m.type!=='string')return;
 if(m.type==='hello'&&exact(m,'nonce,type,v')){send('ready');return;}
 if(m.type==='cancel'&&exact(m,'nonce,type,v')){stop();send('stopped');return;}
 if(m.type!=='start'||worker||!exact(m,'nonce,request,type,v,workerSource')||typeof m.workerSource!=='string'||m.workerSource.length<1||m.workerSource.length>${MAX_WORKER_SOURCE_CHARS}||!m.request||typeof m.request!=='object'||new TextEncoder().encode(JSON.stringify(m.request)).length>${MAX_REQUEST_BYTES})return;
 active=true;try{url=URL.createObjectURL(new Blob([m.workerSource],{type:'text/javascript'}));worker=new Worker(url);}catch(error){stop();send('error',{message:'regex worker could not start'});return;}
 worker.addEventListener('message',event=>{if(!active||!event.data||typeof event.data!=='object')return;const r=event.data;if(!Number.isSafeInteger(r.runId)||typeof r.ok!=='boolean'||new TextEncoder().encode(JSON.stringify(r)).length>${MAX_REQUEST_BYTES}){stop();send('error',{message:'regex worker returned an invalid result'});return;}send('reply',{reply:r});stop();});
 worker.addEventListener('error',()=>{stop();send('error',{message:'regex worker failed'});});worker.postMessage(m.request);
});addEventListener('pagehide',stop);
</script>`;
}

/** The host receives only the worker's value reply; both realms verify source, origin and nonce. */
export function createOpaqueRegexWorker(workerSource: string): Worker {
  if (typeof document === "undefined" || typeof window === "undefined" || workerSource.length < 1 || workerSource.length > MAX_WORKER_SOURCE_CHARS) throw new Error("RUNTIME_UNAVAILABLE: Browser regex worker bundle is unavailable");
  const nonce = crypto.randomUUID(), parentOrigin = location.origin, frame = document.createElement("iframe");
  frame.title = "Regex preview worker"; frame.hidden = true; frame.sandbox.add("allow-scripts"); frame.referrerPolicy = "no-referrer";
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  let ready = false, closed = false, queued: unknown;
  const fire = (type: string, event: Event): void => { for (const listener of listeners.get(type) ?? []) typeof listener === "function" ? listener(event) : listener.handleEvent(event); };
  const stop = (): void => {
    if (closed) return; closed = true; window.removeEventListener("message", receive); window.removeEventListener("pagehide", stop); frame.remove();
    if (ready) frame.contentWindow?.postMessage({ v: 1, type: "cancel", nonce }, "*"); listeners.clear();
  };
  const receive = (event: MessageEvent<unknown>): void => {
    if (closed || event.origin !== "null" || event.source !== frame.contentWindow || !isRecord(event.data)) return;
    const data = event.data as Record<string, unknown>;
    if (data.v !== 1 || data.nonce !== nonce || typeof data.type !== "string") return;
    if (data.type === "ready" && Object.keys(data).sort().join(",") === "nonce,type,v" && !ready) {
      ready = true;
      if (queued !== undefined) { frame.contentWindow?.postMessage({ v: 1, type: "start", nonce, workerSource, request: queued }, "*"); queued = undefined; }
    } else if (data.type === "reply" && Object.keys(data).sort().join(",") === "nonce,reply,type,v" && data.reply && typeof data.reply === "object") {
      fire("message", new MessageEvent("message", { data: data.reply }));
    } else if (data.type === "error" && Object.keys(data).sort().join(",") === "message,nonce,type,v") {
      fire("error", new ErrorEvent("error", { message: typeof data.message === "string" ? data.message : "regex worker failed" }));
    }
  };
  window.addEventListener("message", receive); window.addEventListener("pagehide", stop, { once: true });
  frame.addEventListener("load", () => frame.contentWindow?.postMessage({ v: 1, type: "hello", nonce }, "*"), { once: true });
  frame.srcdoc = frameHtml(parentOrigin, nonce); document.body.append(frame);
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) { const set = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { listeners.get(type)?.delete(listener); },
    postMessage(message: unknown) {
      if (closed) throw new Error("regex worker is stopped");
      if (new TextEncoder().encode(JSON.stringify(message)).byteLength > MAX_REQUEST_BYTES) throw new Error("regex worker request exceeds its byte limit");
      if (ready) frame.contentWindow?.postMessage({ v: 1, type: "start", nonce, workerSource, request: message }, "*"); else queued = message;
    },
    terminate: stop,
  } as unknown as Worker;
}
