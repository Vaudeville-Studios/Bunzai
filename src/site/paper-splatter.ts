/** A bounded, deterministic paper-and-ink burst confined to the symbol stage. */
const MAX_PIXELS = 500_000;
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const EXPAND_MS = 100;

type Piece = { angle: number; distance: number; length: number; width: number; corners: 3 | 4; shade: boolean; spin: number };
export type PaperSplatter = { seed: number; main: string; shadow: string };
export interface PaperSplatterHandle { burst(value: PaperSplatter): void; clear(): void; stop(): void }

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function makePieces(seed: number): Piece[] {
  const random = seeded(seed);
  const direction = Math.PI + (random() - 0.5) * 0.2;
  return Array.from({ length: 10 }, (_, index) => ({
    angle: direction + (random() * 2 - 1) * (0.45 + random() * 0.25),
    distance: 0.75 + index * 0.04 + random() * 0.06,
    length: 0.25 + random() * 0.15,
    width: 0.06 + random() * 0.08,
    corners: (random() < 0.55 ? 3 : 4) as 3 | 4,
    shade: index % 3 === 1 || index % 5 === 3,
    spin: 0.018 + random() * 0.034,
  }));
}

export function createPaperSplatter(canvas: HTMLCanvasElement): PaperSplatterHandle {
  const win = canvas.ownerDocument.defaultView;
  const context = canvas.getContext("2d");
  if (!win || !context) return { burst() {}, clear() {}, stop() {} };
  const view = win;
  const surface = context;
  const motion = view.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  const forced = view.matchMedia?.("(forced-colors: active)") ?? { matches: false, addEventListener() {}, removeEventListener() {} };
  let stopped = false;
  let active = false;
  let frame = 0;
  let startedAt = 0;
  let hiddenAt = 0;
  let lastDraw = 0;
  let width = 0;
  let height = 0;
  let pieces: Piece[] = [];
  let main = "";
  let shadow = "";

  const cancel = (): void => {
    if (!frame) return;
    view.clearTimeout(frame);
    frame = 0;
  };
  const clear = (): void => { surface.clearRect(0, 0, canvas.width, canvas.height); };
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(MAX_DPR, Math.max(1, view.devicePixelRatio || 1), Math.sqrt(MAX_PIXELS / (rect.width * rect.height)));
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    surface.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const request = (): void => {
    if (frame || stopped || !active) return;
    frame = view.setTimeout(() => draw(view.performance.now()), FRAME_MS);
  };
  const polygon = (piece: Piece, scale: number, radius: number, elapsed: number): void => {
    const seconds = Math.max(0, elapsed - EXPAND_MS) / 1000;
    const distance = piece.distance + seconds * 0.003;
    const x = Math.cos(piece.angle) * distance * radius * scale;
    const y = Math.sin(piece.angle) * distance * radius * scale;
    const length = piece.length * radius * scale;
    const halfWidth = piece.width * radius * scale / 2;
    surface.save();
    surface.translate(x, y);
    surface.rotate(piece.angle + piece.spin * seconds);
    surface.beginPath();
    const corners = piece.corners === 3
      ? [[length / 2, 0], [-length / 2, -halfWidth], [-length * 0.34, halfWidth]]
      : [[length / 2, 0], [-length * 0.22, -halfWidth], [-length / 2, 0], [-length * 0.22, halfWidth]];
    for (const [index, [px, py]] of corners.entries()) {
      if (index === 0) surface.moveTo(px!, py!); else surface.lineTo(px!, py!);
    }
    surface.closePath();
    surface.fillStyle = piece.shade ? shadow : main;
    surface.fill();
    surface.restore();
  };
  function draw(now: number): void {
    frame = 0;
    if (stopped || !active || canvas.ownerDocument.hidden || motion.matches || forced.matches) return;
    if (now - lastDraw < FRAME_MS) { request(); return; }
    lastDraw = now;
    try {
      resize();
      if (!width || !height) return;
      clear();
      const elapsed = Math.max(0, now - startedAt);
      const expansion = Math.min(1, elapsed / EXPAND_MS);
      const eased = 1 - (1 - expansion) * (1 - expansion) * (1 - expansion);
      const radius = Math.min(width, height) * 0.35;
      surface.save();
      surface.translate(width / 2, height / 2);
      for (const piece of pieces) polygon(piece, eased, radius, elapsed);
      surface.restore();
      request();
    } catch { active = false; clear(); }
  }
  function visibility(): void {
    if (canvas.ownerDocument.hidden) { hiddenAt = view.performance.now(); cancel(); }
    else if (active) { startedAt += view.performance.now() - hiddenAt; draw(view.performance.now()); }
  }
  function preference(): void {
    if (motion.matches || forced.matches) { active = false; cancel(); clear(); }
  }
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearBurst();
    view.removeEventListener("resize", onResize);
    view.removeEventListener("pagehide", stop);
    canvas.ownerDocument.removeEventListener("visibilitychange", visibility);
    motion.removeEventListener("change", preference);
    forced.removeEventListener("change", preference);
  }
  function clearBurst(): void { active = false; cancel(); pieces = []; clear(); }
  function onResize(): void { if (active) draw(view.performance.now()); }
  view.addEventListener("resize", onResize);
  view.addEventListener("pagehide", stop, { once: true });
  canvas.ownerDocument.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", preference);
  forced.addEventListener("change", preference);

  return {
    burst(value) {
      if (stopped || motion.matches || forced.matches || !canvas.isConnected) { active = false; cancel(); clear(); return; }
      main = value.main;
      shadow = value.shadow;
      pieces = makePieces(value.seed);
      startedAt = view.performance.now();
      lastDraw = startedAt - FRAME_MS;
      active = true;
      cancel();
      draw(startedAt);
    },
    clear: clearBurst,
    stop,
  };
}
