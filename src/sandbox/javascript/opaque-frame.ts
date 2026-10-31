/** Trusted static Browser bootstrap. The iframe has an opaque origin and owns the killable Worker. */
import { RELEASE_JS_LIMITS } from "./limits";

export function opaqueWorkerFrameHtml(parentOrigin: string, nonce: string): string {
  const origin = JSON.stringify(parentOrigin);
  const token = JSON.stringify(nonce);
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">
const PARENT_ORIGIN=${origin}, TOKEN=${token}, MAX_PENDING=${RELEASE_JS_LIMITS.maxPending}; let worker, workerUrl, active=false; const pending=new Set();
const send=(type,extra={})=>parent.postMessage({v:1,type,nonce:TOKEN,...extra},'*');
const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join(',')===keys;
const stop=()=>{active=false;worker?.terminate();worker=undefined;if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=undefined;}pending.clear();};
const reply=(event)=>{const message=event.data;if(event.source!==parent||event.origin!==PARENT_ORIGIN||!message||message.v!==1||message.nonce!==TOKEN||typeof message.type!=='string')return;
 if(message.type==='hello'&&exact(message,'nonce,type,v')){send('ready');return;}
 if(message.type==='cancel'&&exact(message,'nonce,type,v')){stop();send('stopped');return;}
 if(message.type==='reply'&&active&&exact(message,'nonce,reply,type,v')){const reply=message.reply;if(!pending.has(reply?.id))return;if(exact(reply,'id,ok,type,v,value')&&reply.v===1&&reply.type==='reply'&&reply.ok===true){pending.delete(reply.id);worker?.postMessage(reply);}else if(exact(reply,'error,id,ok,type,v')&&reply.v===1&&reply.type==='reply'&&reply.ok===false&&exact(reply.error,'code,message')){pending.delete(reply.id);worker?.postMessage(reply);}return;}
 if(message.type!=='start'||worker||!exact(message,'invocation,invocationResources,nonce,source,type,v,wasmBase64,workerSource')||typeof message.source!=='string'||typeof message.workerSource!=='string'||typeof message.wasmBase64!=='string'||!Array.isArray(message.invocationResources)||message.invocationResources.length>16||message.workerSource.length>5_000_000||message.wasmBase64.length>1_000_000)return;
 active=true;let wasm;try{const raw=atob(message.wasmBase64);wasm=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)wasm[i]=raw.charCodeAt(i);}catch{send('error',{message:'RUNTIME_UNAVAILABLE: invalid bundled WASM'});return;}
 workerUrl=URL.createObjectURL(new Blob([message.workerSource],{type:'text/javascript'}));try{worker=new Worker(workerUrl);}catch(error){const detail=String(error);stop();send('error',{message:'RUNTIME_UNAVAILABLE: worker constructor '+detail});return;}
 worker.addEventListener('message',event=>{if(!active||!event.data||typeof event.data!=='object')return;const data=event.data;
  if(data.type==='result'&&Object.keys(data).sort().join(',')==='logs,type,value'&&Array.isArray(data.logs)&&data.logs.length<=64&&data.logs.every(line=>typeof line==='string'&&new TextEncoder().encode(line).length<=2048)){send('result',{value:data.value,logs:data.logs});stop();}
  else if(data.type==='error'&&Object.keys(data).sort().join(',')==='message,type'&&typeof data.message==='string'){send('error',{message:data.message.slice(0,500)});stop();}
  else if(data&&typeof data==='object'&&data.v===1&&data.type==='request'&&Object.keys(data).sort().join(',')==='args,id,operation,type,v'){if(pending.has(data.id)||pending.size>=MAX_PENDING){send('error',{message:'LIMIT_EXCEEDED: too many pending host requests'});stop();return;}pending.add(data.id);send('request',{request:data});}
  else{send('error',{message:'INVALID_REQUEST: malformed worker message'});stop();}
 });
 worker.addEventListener('error',event=>{send('error',{message:'RUNTIME_UNAVAILABLE: QuickJS worker '+(event.message||'failed')});stop();});
 worker.postMessage({type:'start',source:message.source,invocation:message.invocation,invocationResources:message.invocationResources,wasmBinary:wasm});
};
addEventListener('message',reply);
</script>`;
}
