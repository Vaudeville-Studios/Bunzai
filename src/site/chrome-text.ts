/** Transparent, glyph-masked chrome for the preroll; the source text is the permanent fallback. */
import { Renderer, Program, Triangle, Mesh, Texture } from "ogl";
import { sampleCssColor } from "./canvas-colors";

const MAX_PIXELS = 1_000_000;
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;

const VERTEX = `attribute vec2 position;
varying vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `precision mediump float;
uniform sampler2D uMask;
uniform vec2 uResolution;
uniform vec2 uTextOffset;
uniform vec2 uTextSize;
uniform vec3 uBase;
uniform vec3 uHighlight;
uniform vec3 uShadow;
uniform vec3 uAccent;
uniform float uTime;
uniform float uPulse;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 px = 1.0 / uResolution;
  float a = texture2D(uMask, uv).a;
  if (a < 0.015) { gl_FragColor = vec4(0.0); return; }
  float left = texture2D(uMask, uv - vec2(px.x, 0.0)).a;
  float right = texture2D(uMask, uv + vec2(px.x, 0.0)).a;
  float up = texture2D(uMask, uv + vec2(0.0, px.y)).a;
  float down = texture2D(uMask, uv - vec2(0.0, px.y)).a;
  vec2 gradient = vec2(left - right, down - up);
  float gradientLength = length(gradient);
  vec2 normal = gradient / max(gradientLength, 0.0001);
  vec2 local = (vec2(uv.x, 1.0 - uv.y) * uResolution - uTextOffset) / max(uTextSize, vec2(1.0));
  float flow = sin((local.x * 4.0 + local.y * 1.7 + uTime * 0.42) * 6.28318 + normal.x * 1.5);
  float band = smoothstep(0.24, 0.96, flow + normal.y * 0.20);
  float rim = smoothstep(0.025, 0.22, gradientLength + band * 0.035);
  float rippleRadius = length((uv - vec2(0.5)) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0));
  float ripple = (1.0 - smoothstep(0.0, 0.08, abs(rippleRadius - (uTime - uPulse) * 0.42))) * step(0.0, uPulse) * step(uTime - uPulse, 1.15);
  vec3 chrome = mix(uShadow, uBase, 0.48 + 0.18 * normal.y);
  chrome = mix(chrome, uHighlight, clamp(band * 0.72 + rim * 0.18 + ripple * 0.42, 0.0, 1.0));
  chrome = mix(chrome, uAccent, clamp((1.0 - band) * rim * 0.10 + ripple * 0.08, 0.0, 0.16));
  gl_FragColor = vec4(chrome, a);
}`;

export interface ChromeTextHandle {
  /** Rerasterize the latest DOM phrase and resize the transparent overlay. */
  refresh(): void;
  /** Coalesce a brief reflected ripple with any pulse in the current frame. */
  pulse(): void;
  /** Release observers, frames, shaders, geometry, and textures. Safe to call repeatedly. */
  stop(): void;
}

/** Draws only within the source glyph mask. Failures leave the visible DOM phrase untouched. */
export function createChromeText(canvas: HTMLCanvasElement, source: HTMLElement): ChromeTextHandle {
  let stopped = false;
  let failed = false;
  let lastFrame = 0;
  let pulseAt = -10;
  let refreshPending = false;
  let disposeRenderer: (() => void) | undefined;
  let refreshActive: (() => void) | undefined;
  const win = canvas.ownerDocument.defaultView;
  if (!win) return { refresh() {}, pulse() {}, stop() {} };
  const requestFrame = (callback: FrameRequestCallback): number => typeof win.requestAnimationFrame === "function"
    ? win.requestAnimationFrame(callback)
    : win.setTimeout(() => callback(win.performance.now()), FRAME_MS);
  const cancelFrame = (id: number): void => {
    if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(id);
    else win.clearTimeout(id);
  };
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const forcedColors = win.matchMedia?.("(forced-colors: active)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };

  const setup = (): void => {
    if (stopped || failed || motion.matches || forcedColors.matches || !canvas.isConnected || !source.isConnected) return;
    let renderer: Renderer | undefined;
    let geometry: Triangle | undefined;
    let texture: Texture | undefined;
    let program: Program | undefined;
    let frameMesh: Mesh | undefined;
    let mask: HTMLCanvasElement | undefined;
    let maskContext: CanvasRenderingContext2D | null = null;
    let colorContext: CanvasRenderingContext2D | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let fontSet: FontFaceSet | undefined;
    let frame = 0;
    let dead = false;
    let textOffset: [number, number] = [0, 0];
    let textSize: [number, number] = [1, 1];
    const originalWidth = canvas.style.width;
    const originalHeight = canvas.style.height;

    const release = (): void => {
      if (dead) return;
      dead = true;
      cancelFrame(frame);
      try { resizeObserver?.disconnect(); } catch {}
      try { fontSet?.removeEventListener("loadingdone", queueRefresh); } catch {}
      try { canvas.ownerDocument.removeEventListener("visibilitychange", visibility); } catch {}
      try { canvas.removeEventListener("webglcontextlost", contextLost); } catch {}
      try { if (renderer && !renderer.gl.isContextLost()) renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT); } catch {}
      if (renderer && program) {
        try { renderer.gl.useProgram(null); } catch {}
        try { renderer.gl.deleteShader(program.vertexShader); } catch {}
        try { renderer.gl.deleteShader(program.fragmentShader); } catch {}
        try { program.remove(); } catch {}
      }
      try { geometry?.remove(); } catch {}
      try { if (renderer && texture) renderer.gl.deleteTexture(texture.texture); } catch {}
      mask = undefined;
      canvas.style.width = originalWidth;
      canvas.style.height = originalHeight;
      disposeRenderer = undefined;
      refreshActive = undefined;
    };
    const contextLost = (event: Event): void => {
      event.preventDefault();
      failed = true;
      canvas.style.visibility = "hidden";
      release();
    };
    const drawMask = (): void => {
      if (!renderer || !mask || !maskContext || dead) return;
      const canvasRect = canvas.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const canvasWidth = canvas.offsetWidth;
      const canvasHeight = canvas.offsetHeight;
      const style = win.getComputedStyle(source);
      const text = source.textContent ?? "";
      if (!canvasRect.width || !canvasRect.height || !canvasWidth || !canvasHeight || !source.offsetWidth || !source.offsetHeight || !text) return;
      const ratio = renderer.dpr;
      if (mask.width !== canvas.width || mask.height !== canvas.height) {
        mask.width = canvas.width;
        mask.height = canvas.height;
      }
      maskContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      maskContext.clearRect(0, 0, canvasWidth, canvasHeight);
      maskContext.fillStyle = "white";
      maskContext.strokeStyle = "white";
      maskContext.font = style.font;
      maskContext.textAlign = "left";
      maskContext.textBaseline = "alphabetic";
      const scaleX = canvasRect.width / canvasWidth;
      const scaleY = canvasRect.height / canvasHeight;
      const textNode = source.firstChild;
      if (!textNode || textNode.nodeType !== 3) throw new Error("Preroll word must be a text node");
      const range = source.ownerDocument.createRange();
      let offset = 0;
      for (const glyph of text) {
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset + glyph.length);
        const glyphRect = range.getBoundingClientRect();
        const metrics = maskContext.measureText(glyph);
        const ascent = metrics.actualBoundingBoxAscent || Number.parseFloat(style.fontSize) * 0.75;
        const descent = metrics.actualBoundingBoxDescent || Number.parseFloat(style.fontSize) * 0.25;
        const top = (glyphRect.top - canvasRect.top) / scaleY;
        const height = glyphRect.height / scaleY;
        const baseline = top + (height - ascent - descent) / 2 + ascent;
        const x = (glyphRect.left - canvasRect.left) / scaleX;
        const stroke = Number.parseFloat(style.getPropertyValue("-webkit-text-stroke-width")) || 0;
        if (stroke > 0) { maskContext.lineWidth = stroke; maskContext.strokeText(glyph, x, baseline); }
        maskContext.fillText(glyph, x, baseline);
        offset += glyph.length;
      }
      textOffset = [(sourceRect.left - canvasRect.left) / scaleX * ratio, (sourceRect.top - canvasRect.top) / scaleY * ratio];
      textSize = [source.offsetWidth * ratio, source.offsetHeight * ratio];
      texture!.image = mask;
      texture!.needsUpdate = true;
      program!.uniforms.uTextOffset.value = textOffset;
      program!.uniforms.uTextSize.value = textSize;
      const computed = win.getComputedStyle(canvas);
      program!.uniforms.uBase.value = sampleCssColor(colorContext!, computed.getPropertyValue("--fg2") || style.color);
      program!.uniforms.uHighlight.value = sampleCssColor(colorContext!, computed.getPropertyValue("--fg") || style.color);
      program!.uniforms.uShadow.value = sampleCssColor(colorContext!, computed.getPropertyValue("--ink") || style.color);
      program!.uniforms.uAccent.value = sampleCssColor(colorContext!, style.color);
    };
    function refresh(): void {
      if (dead) return;
      try {
        refreshPending = false;
        const rect = canvas.getBoundingClientRect();
        const cssWidth = Math.max(1, canvas.offsetWidth);
        const cssHeight = Math.max(1, canvas.offsetHeight);
        if (!rect.width || !rect.height || !cssWidth || !cssHeight) return;
        const dpr = Math.min(MAX_DPR, Math.max(1, win?.devicePixelRatio || 1), Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)));
        renderer!.dpr = dpr;
        if (renderer!.width !== cssWidth || renderer!.height !== cssHeight || canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) renderer!.setSize(cssWidth, cssHeight);
        program!.uniforms.uResolution.value = [canvas.width, canvas.height];
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        drawMask();
        scheduleFrame();
      } catch {
        failed = true;
        release();
      }
    }
    const queueRefresh = (): void => {
      if (refreshPending || dead) return;
      refreshPending = true;
      scheduleFrame();
    };
    const render = (now: number): void => {
      frame = 0;
      if (dead) return;
      try {
        if (refreshPending) refresh();
        if (dead || canvas.ownerDocument.hidden || !renderer || !frameMesh || renderer.gl.isContextLost()) return;
        if (now - lastFrame >= FRAME_MS) {
          lastFrame = now;
          program!.uniforms.uTime.value = now / 1000;
          program!.uniforms.uPulse.value = pulseAt;
          renderer.render({ scene: frameMesh, clear: true });
        }
        scheduleFrame();
      } catch {
        failed = true;
        canvas.style.visibility = "hidden";
        release();
      }
    };
    const scheduleFrame = (): void => { if (!frame && !dead) frame = requestFrame(render); };
    function visibility(): void {
      if (frame) cancelFrame(frame);
      frame = 0;
      if (!canvas.ownerDocument.hidden && !dead) scheduleFrame();
    }

    try {
      canvas.style.visibility = "";
      const initialRect = canvas.getBoundingClientRect();
      renderer = new Renderer({ canvas, width: Math.max(1, canvas.offsetWidth || initialRect.width), height: Math.max(1, canvas.offsetHeight || initialRect.height), alpha: true, premultipliedAlpha: false, depth: false, antialias: false, dpr: 1, powerPreference: "low-power", autoClear: true });
      const gl = renderer.gl;
      if (!gl) throw new Error("WebGL unavailable");
      gl.clearColor(0, 0, 0, 0);
      geometry = new Triangle(gl);
      mask = canvas.ownerDocument.createElement("canvas");
      maskContext = mask.getContext("2d", { alpha: true, willReadFrequently: false });
      const colorCanvas = canvas.ownerDocument.createElement("canvas");
      colorCanvas.width = colorCanvas.height = 1;
      colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
      if (!maskContext || !colorContext) throw new Error("Canvas 2D unavailable");
      texture = new Texture(gl, { image: mask, generateMipmaps: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR, flipY: true });
      program = new Program(gl, {
        vertex: VERTEX,
        fragment: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uMask: { value: texture }, uResolution: { value: [1, 1] }, uTextOffset: { value: [0, 0] }, uTextSize: { value: [1, 1] },
          uBase: { value: [1, 1, 1] }, uHighlight: { value: [1, 1, 1] }, uShadow: { value: [0, 0, 0] }, uAccent: { value: [1, 0, 0] }, uTime: { value: 0 }, uPulse: { value: -10 },
        },
      });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error("Chrome shader link failed");
      frameMesh = new Mesh(gl, { geometry, program });
      resizeObserver = new ResizeObserver(queueRefresh);
      resizeObserver.observe(canvas);
      resizeObserver.observe(source);
      fontSet = canvas.ownerDocument.fonts;
      fontSet?.addEventListener("loadingdone", queueRefresh);
      canvas.addEventListener("webglcontextlost", contextLost);
      canvas.ownerDocument.addEventListener("visibilitychange", visibility);
      disposeRenderer = release;
      refreshActive = refresh;
      refresh();
      if (fontSet?.status === "loading") void fontSet.ready.then(queueRefresh, () => {});
    } catch {
      failed = true;
      release();
    }
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    disposeRenderer?.();
    motion.removeEventListener("change", preferenceChanged);
    forcedColors.removeEventListener("change", preferenceChanged);
    win.removeEventListener("pagehide", stop);
    refreshActive = undefined;
  };
  function preferenceChanged(): void {
    if (motion.matches || forcedColors.matches) { disposeRenderer?.(); return; }
    setup();
  }
  motion.addEventListener("change", preferenceChanged);
  forcedColors.addEventListener("change", preferenceChanged);
  win.addEventListener("pagehide", stop, { once: true });
  setup();
  return {
    refresh: () => { if (!motion.matches && !forcedColors.matches) { if (!disposeRenderer) setup(); else refreshActive?.(); } },
    pulse: () => { if (!stopped && !motion.matches && !forcedColors.matches && disposeRenderer) { pulseAt = win.performance.now() / 1000; } },
    stop,
  };
}
