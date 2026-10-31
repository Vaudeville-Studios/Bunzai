/** Low-cost image-to-stencil transition for the preroll's story-world plates. */
import { Mesh, Program, Renderer, Texture, Triangle } from "ogl";
import { sampleCssColor } from "./canvas-colors";

const MAX_PIXELS = 1_000_000;
const MAX_TEXTURE_EDGE = 1200;
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 15;
const REACTIVE_FRAME_MS = 250;
const IMPACT_MS = 190;
const LATE_IMAGE_REVEAL_MS = 550;

const VERTEX = `attribute vec2 position;
varying vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `precision mediump float;
uniform sampler2D uImage;
uniform vec2 uImageResolution;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uLight;
uniform float uTime;
uniform float uImpact;
varying vec2 vUv;
float luminance(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 photo = texture2D(uImage, vUv);
  vec2 px = 1.0 / uImageResolution;
  float tl = luminance(texture2D(uImage, vUv + vec2(-px.x, px.y)).rgb);
  float tc = luminance(texture2D(uImage, vUv + vec2(0.0, px.y)).rgb);
  float tr = luminance(texture2D(uImage, vUv + px).rgb);
  float ml = luminance(texture2D(uImage, vUv - vec2(px.x, 0.0)).rgb);
  float mr = luminance(texture2D(uImage, vUv + vec2(px.x, 0.0)).rgb);
  float bl = luminance(texture2D(uImage, vUv - px).rgb);
  float bc = luminance(texture2D(uImage, vUv - vec2(0.0, px.y)).rgb);
  float br = luminance(texture2D(uImage, vUv + vec2(px.x, -px.y)).rgb);
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float edge = smoothstep(0.22, 0.72, length(vec2(gx, gy)));
  float luma = clamp(luminance(photo.rgb) + sin(uTime * 0.34) * 0.008, 0.0, 1.0);
  vec3 cutout = luma < 0.27 ? uInk : luma < 0.57 ? uAccent : luma < 0.82 ? mix(uAccent, uLight, 0.42) : uLight;
  cutout = mix(cutout, uInk, edge * 0.94);
  float impact = smoothstep(0.0, 1.0, clamp(uImpact, 0.0, 1.0));
  gl_FragColor = vec4(mix(photo.rgb, cutout, impact), photo.a);
}`;

export interface WorldStencilHandle {
  /** Resolve true after the decoded source image has reached the transparent WebGL overlay. */
  prepare(): Promise<boolean>;
  /** Begin the image-backed posterize and outline impact. */
  activate(): void;
  /** Recheck dimensions or a newly loaded source image. */
  refresh(): void;
  /** True only after at least one source-image frame reached the WebGL canvas. */
  ready(): boolean;
  /** Keep the original image visible and release rendering resources. */
  stop(): void;
}

/** The source image remains visible below the canvas until a successful image-backed draw. */
export function createWorldStencil(canvas: HTMLCanvasElement, image: HTMLImageElement): WorldStencilHandle {
  const win = canvas.ownerDocument.defaultView;
  if (!win) return { prepare: () => Promise.resolve(false), activate() {}, refresh() {}, ready: () => false, stop() {} };
  const view = win;
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  const forcedColors = win.matchMedia?.("(forced-colors: active)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  let active = false;
  let stopped = false;
  let failed = false;
  let isReady = false;
  let impactAt = 0;
  let pendingImageImpact = false;
  let dispose: (() => void) | undefined;
  let refreshDraw: (() => void) | undefined;
  let resolvePrepared: ((ready: boolean) => void) | undefined;
  const prepared = new Promise<boolean>(resolve => { resolvePrepared = resolve; });
  const finishPrepare = (ready: boolean): void => { resolvePrepared?.(ready); resolvePrepared = undefined; };

  const setup = (): void => {
    if (stopped || failed || motion.matches || forcedColors.matches || !canvas.isConnected || !image.isConnected) return;
    let renderer: Renderer | undefined;
    let geometry: Triangle | undefined;
    let program: Program | undefined;
    let texture: Texture | undefined;
    let mesh: Mesh | undefined;
    let pixelCanvas: HTMLCanvasElement | undefined;
    let pixelContext: CanvasRenderingContext2D | null = null;
    let imageCanvas: HTMLCanvasElement | undefined;
    let imageContext: CanvasRenderingContext2D | null = null;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let lastFrame = 0;
    let dead = false;
    let frameIsTimer = false;
    let imageKey = "";
    let refreshQueued = false;
    const originalWidth = canvas.style.width;
    const originalHeight = canvas.style.height;

    const release = (): void => {
      if (dead) return;
      dead = true;
      cancelFrame(frame);
      try { observer?.disconnect(); } catch {}
      image.removeEventListener("load", queueRefresh);
      image.removeEventListener("error", imageError);
      canvas.ownerDocument.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", contextLost);
      try { if (renderer && !renderer.gl.isContextLost()) renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT); } catch {}
      if (renderer && program) {
        try { renderer.gl.useProgram(null); } catch {}
        try { renderer.gl.deleteShader(program.vertexShader); } catch {}
        try { renderer.gl.deleteShader(program.fragmentShader); } catch {}
        try { program.remove(); } catch {}
      }
      try { geometry?.remove(); } catch {}
      try { if (renderer && texture) renderer.gl.deleteTexture(texture.texture); } catch {}
      dispose = undefined;
      refreshDraw = undefined;
      if (!isReady) finishPrepare(false);
      isReady = false;
      canvas.style.width = originalWidth;
      canvas.style.height = originalHeight;
      imageCanvas = undefined;
      pixelCanvas = undefined;
    };
    const fail = (): void => { failed = true; canvas.style.visibility = "hidden"; release(); };
    const contextLost = (event: Event): void => {
      event.preventDefault();
      fail();
    };
    const imageError = (): void => fail();
    const positionFactor = (token: string | undefined): number => {
      if (!token || token === "center") return 0.5;
      if (token === "left" || token === "top") return 0;
      if (token === "right" || token === "bottom") return 1;
      return token.endsWith("%") ? Math.min(1, Math.max(0, Number.parseFloat(token) / 100)) : 0.5;
    };
    const requestFrame = (callback: FrameRequestCallback): number => typeof view.requestAnimationFrame === "function"
      ? view.requestAnimationFrame(callback)
      : view.setTimeout(() => callback(view.performance.now()), FRAME_MS);
    const cancelFrame = (id: number): void => {
      if (!id) return;
      if (frameIsTimer || typeof view.cancelAnimationFrame !== "function") view.clearTimeout(id);
      else view.cancelAnimationFrame(id);
      frame = 0;
      frameIsTimer = false;
    };
    const schedule = (delay = FRAME_MS): void => {
      if (frame || dead) return;
      if (delay > FRAME_MS) {
        frameIsTimer = true;
        frame = view.setTimeout(() => { frame = 0; frameIsTimer = false; draw(view.performance.now()); }, delay);
      } else {
        frameIsTimer = false;
        frame = requestFrame(draw);
      }
    };
    const resize = (scheduleDraw = true): void => {
      if (!renderer || !pixelCanvas || !imageCanvas || !imageContext || !image.complete || !image.naturalWidth || !image.naturalHeight || dead) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(MAX_DPR, Math.max(1, view.devicePixelRatio || 1), Math.sqrt(MAX_PIXELS / (rect.width * rect.height)));
      const cssWidth = Math.max(1, Math.round(rect.width));
      const cssHeight = Math.max(1, Math.round(rect.height));
      renderer.dpr = dpr;
      if (renderer.width !== cssWidth || renderer.height !== cssHeight || canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) renderer.setSize(cssWidth, cssHeight);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const imageStyle = view.getComputedStyle(image);
      const key = `${image.currentSrc || image.src}|${image.naturalWidth}x${image.naturalHeight}|${rect.width}x${rect.height}|${imageStyle.objectFit}|${imageStyle.objectPosition}`;
      if (imageKey !== key || !imageCanvas.width || !imageCanvas.height) {
        const imageRatio = image.naturalWidth / image.naturalHeight;
        const slotRatio = rect.width / rect.height;
        let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
        if (imageStyle.objectFit === "cover") {
          const [xToken, yToken] = imageStyle.objectPosition.split(/\s+/);
          if (imageRatio > slotRatio) {
            sw = image.naturalHeight * slotRatio;
            sx = (image.naturalWidth - sw) * positionFactor(xToken);
          } else {
            sh = image.naturalWidth / slotRatio;
            sy = (image.naturalHeight - sh) * positionFactor(yToken ?? xToken);
          }
        }
        const scale = Math.min(1, MAX_TEXTURE_EDGE / sw, MAX_TEXTURE_EDGE / sh, Math.sqrt(MAX_PIXELS / (sw * sh)));
        imageCanvas.width = Math.max(1, Math.round(sw * scale));
        imageCanvas.height = Math.max(1, Math.round(sh * scale));
        imageContext.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
        imageContext.drawImage(image, sx, sy, sw, sh, 0, 0, imageCanvas.width, imageCanvas.height);
        texture!.image = imageCanvas;
        texture!.needsUpdate = true;
        imageKey = key;
        if (pendingImageImpact) {
          impactAt = view.performance.now() + LATE_IMAGE_REVEAL_MS;
          pendingImageImpact = false;
        }
      }
      const style = view.getComputedStyle(canvas);
      program!.uniforms.uInk.value = sampleCssColor(pixelContext!, style.getPropertyValue("--ink"));
      program!.uniforms.uAccent.value = sampleCssColor(pixelContext!, style.getPropertyValue("--pink"));
      program!.uniforms.uLight.value = sampleCssColor(pixelContext!, style.getPropertyValue("--peach"));
      program!.uniforms.uImageResolution.value = [imageCanvas.width, imageCanvas.height];
      if (scheduleDraw) schedule();
    };
    const safeResize = (scheduleDraw = true): void => {
      try { resize(scheduleDraw); } catch { fail(); }
    };
    function draw(now: number): void {
      frame = 0;
      frameIsTimer = false;
      if (dead || !renderer || !mesh || !image.complete || !image.naturalWidth || canvas.ownerDocument.hidden || renderer.gl.isContextLost()) return;
      try {
        if (refreshQueued) { refreshQueued = false; safeResize(false); }
        if (dead) return;
        if (now - lastFrame < FRAME_MS) { schedule(); return; }
        lastFrame = now;
        const elapsed = active ? Math.max(0, now - impactAt) : 0;
        program!.uniforms.uTime.value = now / 1000;
        program!.uniforms.uImpact.value = active ? Math.min(1, elapsed / IMPACT_MS) : 0;
        renderer.render({ scene: mesh, clear: true });
        if (!isReady) { isReady = true; finishPrepare(true); }
        if (active) schedule(now < impactAt ? impactAt - now : now < impactAt + IMPACT_MS ? FRAME_MS : REACTIVE_FRAME_MS);
      } catch { fail(); }
    }
    const queueRefresh = (): void => {
      if (refreshQueued || dead) return;
      refreshQueued = true;
      schedule();
    };
    function visibility(): void {
      cancelFrame(frame);
      if (!canvas.ownerDocument.hidden && (active || !isReady) && !dead) schedule();
    }

    try {
      canvas.style.visibility = "";
      const rect = canvas.getBoundingClientRect();
      renderer = new Renderer({ canvas, width: Math.max(1, rect.width), height: Math.max(1, rect.height), alpha: true, premultipliedAlpha: false, depth: false, antialias: false, dpr: 1, powerPreference: "low-power", autoClear: true });
      const gl = renderer.gl;
      if (!gl) throw new Error("WebGL unavailable");
      gl.clearColor(0, 0, 0, 0);
      geometry = new Triangle(gl);
      pixelCanvas = canvas.ownerDocument.createElement("canvas");
      pixelCanvas.width = pixelCanvas.height = 1;
      pixelContext = pixelCanvas.getContext("2d", { willReadFrequently: true });
      imageCanvas = canvas.ownerDocument.createElement("canvas");
      imageContext = imageCanvas.getContext("2d", { alpha: true });
      if (!pixelContext || !imageContext) throw new Error("Canvas 2D unavailable");
      texture = new Texture(gl, { image: imageCanvas, generateMipmaps: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR, flipY: true });
      program = new Program(gl, { vertex: VERTEX, fragment: FRAGMENT, transparent: true, depthTest: false, depthWrite: false, uniforms: {
        uImage: { value: texture }, uImageResolution: { value: [1, 1] }, uInk: { value: [0, 0, 0] }, uAccent: { value: [1, 0, 0] }, uLight: { value: [1, 1, 1] }, uTime: { value: 0 }, uImpact: { value: 0 },
      } });
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error("Stencil shader link failed");
      mesh = new Mesh(gl, { geometry, program });
      observer = new ResizeObserver(queueRefresh);
      observer.observe(canvas);
      observer.observe(image);
      image.addEventListener("load", queueRefresh);
      image.addEventListener("error", imageError);
      canvas.addEventListener("webglcontextlost", contextLost);
      canvas.ownerDocument.addEventListener("visibilitychange", visibility);
      dispose = release;
      refreshDraw = safeResize;
      if (image.complete && image.hasAttribute("src") && !image.naturalWidth) { imageError(); return; }
      safeResize();
    } catch {
      failed = true;
      release();
    }
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (!isReady) finishPrepare(false);
    dispose?.();
    motion.removeEventListener("change", preferenceChanged);
    forcedColors.removeEventListener("change", preferenceChanged);
    view.removeEventListener("pagehide", stop);
  };
  function preferenceChanged(): void {
    if (motion.matches || forcedColors.matches) { if (!isReady) finishPrepare(false); dispose?.(); }
    else setup();
  }
  motion.addEventListener("change", preferenceChanged);
  forcedColors.addEventListener("change", preferenceChanged);
  win.addEventListener("pagehide", stop, { once: true });
  setup();
  if (motion.matches || forcedColors.matches) finishPrepare(false);
  return {
    prepare: () => prepared,
    activate() {
      if (stopped || motion.matches || forcedColors.matches) return;
      active = true;
      if (!image.complete || !image.naturalWidth) pendingImageImpact = true;
      else impactAt = view.performance.now();
      if (!dispose) setup();
      refreshDraw?.();
    },
    refresh() { if (!motion.matches && !forcedColors.matches) { if (!dispose) setup(); else refreshDraw?.(); } },
    ready: () => isReady,
    stop,
  };
}
