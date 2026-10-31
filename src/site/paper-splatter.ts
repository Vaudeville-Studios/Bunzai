/** A bounded, deterministic paper-and-ink burst confined to the symbol stage. */
const MAX_PIXELS = 500_000;
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const EXPAND_MS = 100;

type Piece = { angle: number; distance: number; size: number; points: number; shade: boolean; lobe: boolean; radii: number[] };
export type PaperSplatter = { seed: number; main: string; shadow: string };
export interface PaperSplatterHandle { burst(value: PaperSplatter): void; stop(): void }

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
  const turn = random() * Math.PI * 2;
  const clusters = [turn - 0.25, turn + 1.9, turn + 4.35];
  const lobeClusters = [0, 1, 2, 0, 2];
  const shardClusters = [0, 0, 1, 1, 1, 2, 2, 2, 0];
  return Array.from({ length: 14 }, (_, index) => {
    const lobe = index < 5;
    const cluster = lobe ? lobeClusters[index]! : shardClusters[index - 5]!;
    const points = lobe ? 8 + Math.floor(random() * 4) : 4 + Math.floor(random() * 3);
    return {
      angle: clusters[cluster]! + (random() - 0.5) * (lobe ? 0.78 : 0.92),
      distance: lobe ? 0.72 + random() * 0.09 : 0.82 + random() * 0.07,
      size: lobe ? 0.18 + random() * 0.06 : 0.09 + random() * 0.04,
      points,
      shade: !lobe && index % 2 === 1,
      lobe,
      radii: Array.from({ length: points }, () => lobe ? 0.38 + random() * 0.82 : 0.55 + random() * 0.55),
    };
  });
}

export function createPaperSplatter(canvas: HTMLCanvasElement): PaperSplatterHandle {
  const win = canvas.ownerDocument.defaultView;
  const context = canvas.getContext("2d");
  if (!win || !context) return { burst() {}, stop() {} };
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
  let drift = 0.02;

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
  const polygon = (piece: Piece, scale: number, radius: number): void => {
    const x = Math.cos(piece.angle) * piece.distance * radius * scale;
    const y = Math.sin(piece.angle) * piece.distance * radius * scale;
    const size = piece.size * radius * scale;
    surface.save();
    surface.translate(x, y);
    surface.rotate(piece.angle + (piece.lobe ? 0 : Math.PI / 2));
    surface.beginPath();
    for (let point = 0; point < piece.points; point++) {
      const angle = point / piece.points * Math.PI * 2;
      const jagged = piece.radii[point]!;
      const px = Math.cos(angle) * size * jagged;
      const py = Math.sin(angle) * size * (piece.lobe ? 0.72 : 0.25) * jagged;
      if (point === 0) surface.moveTo(px, py); else surface.lineTo(px, py);
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
      const rotation = Math.max(0, elapsed - EXPAND_MS) / 1000 * drift;
      const radius = Math.min(width, height) * 0.49;
      surface.save();
      surface.translate(width / 2 + Math.sin(rotation) * 2, height / 2 + Math.sin(rotation * 0.7) * 2);
      surface.rotate(rotation);
      for (const piece of pieces) polygon(piece, eased, radius);
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
    active = false;
    cancel();
    clear();
    view.removeEventListener("resize", onResize);
    view.removeEventListener("pagehide", stop);
    canvas.ownerDocument.removeEventListener("visibilitychange", visibility);
    motion.removeEventListener("change", preference);
    forced.removeEventListener("change", preference);
  }
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
      drift = (1 + (value.seed >>> 0) % 3) * Math.PI / 180;
      startedAt = view.performance.now();
      lastDraw = startedAt - FRAME_MS;
      active = true;
      cancel();
      draw(startedAt);
    },
    stop,
  };
}
