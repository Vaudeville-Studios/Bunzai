/** Alpha-preserving two-color cut for transparent story cutouts. */
import { Mesh, Program, Renderer, Texture, Triangle } from "ogl";

const MAX_PIXELS = 1_000_000;
const MAX_TEXTURE_EDGE = 1200;
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;

const VERTEX = `attribute vec2 position;
varying vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `precision mediump float;
uniform sampler2D uImage;
uniform vec3 uMain;
uniform vec3 uShadow;
uniform float uImpact;
varying vec2 vUv;
void main() {
  vec4 photo = texture2D(uImage, vUv);
  float broadShadow = step(0.55, vUv.x * 0.58 + (1.0 - vUv.y) * 0.42);
  vec3 cutout = mix(uMain, uShadow, broadShadow);
  gl_FragColor = vec4(mix(photo.rgb, cutout, step(0.5, uImpact)), photo.a);
}`;

export function containedImageRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, alignX = 0.5, alignY = 0.5) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) * alignX, y: (targetHeight - height) * alignY, width, height };
}

function readCssColor(context: CanvasRenderingContext2D, value: string): [number, number, number] {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return [pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255];
}

export interface WorldStencilHandle {
  /** Resolve true after the decoded source image is contain-fitted and rendered once. */
  prepare(): Promise<boolean>;
  /** Apply the two-color cut immediately, preserving the source alpha. */
  activate(mainColor: string, shadowColor: string): void;
  /** Recheck dimensions or a newly loaded source image. */
  refresh(): void;
  /** True only after at least one source-image frame reached the WebGL canvas. */
  ready(): boolean;
  /** Keep the original image visible and release rendering resources. */
  stop(): void;
}

/** The source cutout remains visible below the canvas until a successful image-backed draw. */
export function createWorldStencil(canvas: HTMLCanvasElement, image: HTMLImageElement): WorldStencilHandle {
  const win = canvas.ownerDocument.defaultView;
  if (!win) return { prepare: () => Promise.resolve(false), activate() {}, refresh() {}, ready: () => false, stop() {} };
  const view = win;
  const motion = win.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  const forcedColors = win.matchMedia?.("(forced-colors: active)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  let stopped = false;
  let failed = false;
  let isReady = false;
  let renderedSource = "";
  let active = false;
  let palette: { main: string; shadow: string } | undefined;
  let dispose: (() => void) | undefined;
  let refreshDraw: (() => void) | undefined;
  let clearDraw: (() => void) | undefined;
  let renderCut: (() => void) | undefined;
  let setPalette: ((main: string, shadow: string) => void) | undefined;
  let pending: { source: string; promise: Promise<boolean>; resolve: (ready: boolean) => void } | undefined;
  const finishPrepare = (ready: boolean): void => { pending?.resolve(ready); pending = undefined; };

  const setup = (): void => {
    if (stopped || failed || motion.matches || forcedColors.matches || !canvas.isConnected || !image.isConnected) return;
    let renderer: Renderer | undefined;
    let geometry: Triangle | undefined;
    let program: Program | undefined;
    let texture: Texture | undefined;
    let mesh: Mesh | undefined;
    let imageCanvas: HTMLCanvasElement | undefined;
    let imageContext: CanvasRenderingContext2D | null = null;
    let colorCanvas: HTMLCanvasElement | undefined;
    let colorContext: CanvasRenderingContext2D | null = null;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let lastFrame = 0;
    let dead = false;
    let frameIsTimer = false;
    let imageKey = "";
    let refreshQueued = false;
    const originalWidth = canvas.style.width;
    const originalHeight = canvas.style.height;
    const originalVisibility = canvas.style.visibility;

    const release = (): void => {
      if (dead) return;
      dead = true;
      cancelFrame(frame);
      try { observer?.disconnect(); } catch {}
      image.removeEventListener("load", sourceLoaded);
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
      clearDraw = undefined;
      renderCut = undefined;
      setPalette = undefined;
      finishPrepare(false);
      active = false;
      isReady = false;
      renderedSource = "";
      canvas.style.width = originalWidth;
      canvas.style.height = originalHeight;
      canvas.style.visibility = originalVisibility;
      imageCanvas = undefined;
      colorCanvas = undefined;
      colorContext = null;
    };
    const fail = (): void => { failed = true; release(); };
    const contextLost = (event: Event): void => {
      event.preventDefault();
      fail();
    };
    const imageError = (): void => {
      finishPrepare(false);
      active = false;
      isReady = false;
      renderedSource = "";
      imageKey = "";
      try { renderer?.gl.clear(renderer.gl.COLOR_BUFFER_BIT); } catch { fail(); }
    };
    const sourceLoaded = (): void => {
      if (renderedSource && renderedSource !== image.src) {
        active = false;
        isReady = false;
        renderedSource = "";
        clearDraw?.();
      }
      queueRefresh();
    };
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
      if (!renderer || !imageCanvas || !imageContext || !image.complete || !image.naturalWidth || !image.naturalHeight || dead) return;
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
      const key = `${image.src}|${image.naturalWidth}x${image.naturalHeight}|${rect.width}x${rect.height}|${imageStyle.objectPosition}`;
      if (imageKey !== key || !imageCanvas.width || !imageCanvas.height) {
        const textureScale = Math.min(MAX_TEXTURE_EDGE / cssWidth, MAX_TEXTURE_EDGE / cssHeight, Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight)));
        imageCanvas.width = Math.max(1, Math.round(cssWidth * textureScale));
        imageCanvas.height = Math.max(1, Math.round(cssHeight * textureScale));
        imageContext.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
        const [xToken, yToken] = imageStyle.objectPosition.split(/\s+/);
        const fit = containedImageRect(image.naturalWidth, image.naturalHeight, imageCanvas.width, imageCanvas.height, positionFactor(xToken), positionFactor(yToken ?? xToken));
        imageContext.drawImage(image, fit.x, fit.y, fit.width, fit.height);
        texture!.image = imageCanvas;
        texture!.needsUpdate = true;
        imageKey = key;
      }
      if (palette && colorContext) {
        program!.uniforms.uMain.value = readCssColor(colorContext, palette.main);
        program!.uniforms.uShadow.value = readCssColor(colorContext, palette.shadow);
      }
      program!.uniforms.uImpact.value = active ? 1 : 0;
      if (scheduleDraw) schedule();
    };
    const safeResize = (scheduleDraw = true): void => {
      try { resize(scheduleDraw); } catch { fail(); }
    };
    function draw(now: number, immediate = false): void {
      frame = 0;
      frameIsTimer = false;
      if (dead || !renderer || !mesh || !image.complete || !image.naturalWidth || canvas.ownerDocument.hidden || renderer.gl.isContextLost()) return;
      try {
        if (refreshQueued) { refreshQueued = false; safeResize(false); }
        if (dead) return;
        if (!immediate && now - lastFrame < FRAME_MS) { schedule(); return; }
        lastFrame = now;
        renderer.render({ scene: mesh, clear: true });
        renderedSource = image.src;
        isReady = true;
        if (pending) finishPrepare(renderedSource === pending.source);
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
      imageCanvas = canvas.ownerDocument.createElement("canvas");
      imageContext = imageCanvas.getContext("2d", { alpha: true });
      if (!imageContext) throw new Error("Canvas 2D unavailable");
      colorCanvas = canvas.ownerDocument.createElement("canvas");
      colorCanvas.width = colorCanvas.height = 1;
      colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
      if (!colorContext) throw new Error("Canvas 2D color parsing unavailable");
      texture = new Texture(gl, { image: imageCanvas, generateMipmaps: false, minFilter: gl.LINEAR, magFilter: gl.LINEAR, flipY: true });
      program = new Program(gl, { vertex: VERTEX, fragment: FRAGMENT, transparent: true, depthTest: false, depthWrite: false, uniforms: {
        uImage: { value: texture }, uMain: { value: [1, 1, 1] }, uShadow: { value: [0, 0, 0] }, uImpact: { value: 0 },
      } });
      program.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      setPalette = (main, shadow) => {
        program!.uniforms.uMain.value = readCssColor(colorContext!, main);
        program!.uniforms.uShadow.value = readCssColor(colorContext!, shadow);
      };
      if (palette) setPalette(palette.main, palette.shadow);
      if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) throw new Error("Stencil shader link failed");
      mesh = new Mesh(gl, { geometry, program });
      observer = new ResizeObserver(queueRefresh);
      observer.observe(canvas);
      observer.observe(image);
      image.addEventListener("load", sourceLoaded);
      image.addEventListener("error", imageError);
      canvas.addEventListener("webglcontextlost", contextLost);
      canvas.ownerDocument.addEventListener("visibilitychange", visibility);
      dispose = release;
      refreshDraw = safeResize;
      clearDraw = () => { try { gl.clear(gl.COLOR_BUFFER_BIT); } catch { fail(); } };
      renderCut = () => { cancelFrame(frame); safeResize(false); draw(view.performance.now(), true); };
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
    finishPrepare(false);
    dispose?.();
    motion.removeEventListener("change", preferenceChanged);
    forcedColors.removeEventListener("change", preferenceChanged);
    view.removeEventListener("pagehide", stop);
  };
  function preferenceChanged(): void {
    if (motion.matches || forcedColors.matches) { finishPrepare(false); dispose?.(); }
    else setup();
  }
  motion.addEventListener("change", preferenceChanged);
  forcedColors.addEventListener("change", preferenceChanged);
  win.addEventListener("pagehide", stop, { once: true });
  setup();
  return {
    prepare() {
      const source = image.src;
      if (!source || stopped || failed || motion.matches || forcedColors.matches || (image.complete && !image.naturalWidth)) return Promise.resolve(false);
      if (isReady && renderedSource === source) return Promise.resolve(true);
      if (pending?.source === source) return pending.promise;
      finishPrepare(false);
      active = false;
      isReady = false;
      renderedSource = "";
      clearDraw?.();
      const next: { source: string; promise: Promise<boolean>; resolve: (ready: boolean) => void } = {
        source,
        promise: Promise.resolve(false),
        resolve: () => {},
      };
      next.promise = new Promise<boolean>(resolve => { next.resolve = resolve; });
      pending = next;
      if (!dispose) setup();
      else refreshDraw?.();
      return next.promise;
    },
    activate(mainColor, shadowColor) {
      if (stopped || motion.matches || forcedColors.matches) return;
      active = true;
      palette = { main: mainColor, shadow: shadowColor };
      setPalette?.(mainColor, shadowColor);
      if (!dispose) setup();
      if (renderCut) renderCut(); else refreshDraw?.();
    },
    refresh() { if (!motion.matches && !forcedColors.matches) { if (!dispose) setup(); else refreshDraw?.(); } },
    ready: () => isReady && renderedSource === image.src,
    stop,
  };
}
