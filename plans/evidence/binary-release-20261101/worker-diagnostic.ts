/** Isolates interpreted versus compiled worker discovery for the public activation failure. */
import {runJavaScriptInWorker} from '../../../src/sandbox/javascript/run-in-worker.ts';
const source='bunzai.extension.define({commands:{run:()=>({sum:4,fetch:typeof fetch,process:typeof process})}});';
try{console.log(JSON.stringify(await runJavaScriptInWorker(source,async()=>{throw Error('unused')},{invocation:{kind:'command',id:'run',input:null,commands:['run'],events:[]},quickJsWasmBinary:new Uint8Array(await Bun.file('node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm').arrayBuffer())})));}catch(e){console.error(e);process.exitCode=1;}
