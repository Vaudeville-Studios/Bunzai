/** Run the recovered Vaudeville title-card rhythm in the auditorium's native screen. */
import { createChromeText } from './chrome-text';
import { createWorldStencil } from './world-stencil';

export function runScreenPreroll(doc: Document, onComplete: () => void): () => void {
  const root = doc.querySelector<HTMLElement>("[data-screen-preroll]");
  const win = doc.defaultView;
  const skip = root?.querySelector<HTMLButtonElement>("[data-preroll-skip]");
  const motion = win?.matchMedia("(prefers-reduced-motion: reduce)");
  if (!root || !win || !skip || !motion || motion.matches) { onComplete(); return () => {}; }
  const view: Window = win;
  const preference: MediaQueryList = motion;

  const cards = [...root.querySelectorAll<HTMLElement>("[data-preroll-card]")];
  const prefix = root.querySelector<HTMLElement>("[data-preroll-prefix]");
  const word = root.querySelector<HTMLElement>("[data-preroll-word]");
  const wordStage = root.querySelector<HTMLElement>(".screen-preroll-word-stage");
  const chromeCanvas = root.querySelector<HTMLCanvasElement>("[data-preroll-chrome]");
  const worldStage = root.querySelector<HTMLElement>("[data-preroll-worlds]");
  const worldPlates = [...root.querySelectorAll<HTMLImageElement>("[data-preroll-world]")];
  const stencilCanvas = root.querySelector<HTMLCanvasElement>("[data-preroll-world-stencil]");
  const tagline = root.querySelector<HTMLElement>("[data-preroll-tagline]");
  if (cards.length !== 3 || !prefix || !word || !wordStage || !tagline) { onComplete(); return () => {}; }

  const phrases = [
    ["A STAGE", "rose", 2400], ["A STORY", "gold", 2200], ["A DREAM", "lilac", 2000],
    ["A SCENE", "sky", 1800], ["A CANVAS", "rose", 1600], ["UNWRITTEN", "mint", 1400],
    ["UNCHARTED", "sky", 1300], ["WIDE OPEN", "gold", 1200], ["BOUNDLESS", "lilac", 1100],
    ["WAITING", "mint", 1000], ["LISTENING", "gold", 900], ["WATCHING", "rose", 800],
    ["WAKING", "mint", 700], ["SHIFTING", "lilac", 550], ["STIRRING", "rose", 480],
    ["READY", "mint", 420], ["CALLING", "gold", 360], ["CHANGING", "lilac", 300],
    ["ALIVE", "sky", 250], ["YOURS TO SHAPE", "mint", 200], ["YOURS TO DISCOVER", "rose", 170],
    ["YOURS TO EXPLORE", "sky", 145], ["YOURS TO BUILD", "gold", 125], ["YOURS TO IMAGINE", "lilac", 110],
    ["YOURS TO CREATE", "lilac", 95], ["YOURS TO WRITE", "mint", 85], ["YOURS TO BECOME", "rose", 75],
    ["YOURS TO PLAY", "gold", 65], ["YOURS TO HOLD", "lilac", 400], ["YOURS TO TAKE", "rose", 800],
    ["YOURS TO CONQUER", "gold", 1400], ["YOURS", "rose", 3000],
  ] as const;
  let timer = 0;
  let deadline = 0;
  let remaining = 0;
  let next: (() => void) | undefined;
  let stopped = false;
  let chrome: ReturnType<typeof createChromeText> | undefined;
  let stencil: ReturnType<typeof createWorldStencil> | undefined;
  let stencilTimer = 0;
  let stencilDeadline = 0;
  let stencilRemaining = 0;
  let stencilNext: (() => void) | undefined;
  let activeWorld: string | undefined;
  let worldLoad: (() => void) | undefined;

  const cleanup = (): void => {
    win.clearTimeout(timer);
    win.clearTimeout(stencilTimer);
    timer = 0;
    stencilTimer = 0;
    stencilNext = undefined;
    next = undefined;
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("keydown", keydown);
    skip.removeEventListener("click", finish);
    motion.removeEventListener("change", motionChange);
    if (worldLoad) worldPlates.forEach(plate => plate.removeEventListener("load", worldLoad!));
    stencil?.stop();
    stencil = undefined;
    chrome?.stop();
    chrome = undefined;
    root.hidden = true;
    root.inert = true;
  };
  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    cleanup();
    onComplete();
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cleanup();
  };
  const arm = (): void => {
    if (doc.hidden || !next || stopped) return;
    deadline = win.performance.now() + remaining;
    timer = win.setTimeout(() => {
      timer = 0;
      remaining = 0;
      const advance = next;
      next = undefined;
      advance?.();
    }, remaining);
  };
  const wait = (milliseconds: number, advance: () => void): void => {
    win.clearTimeout(timer);
    remaining = milliseconds;
    next = advance;
    arm();
  };
  const armStencil = (): void => {
    if (doc.hidden || !stencilNext || stopped) return;
    stencilDeadline = win.performance.now() + stencilRemaining;
    stencilTimer = win.setTimeout(() => {
      stencilTimer = 0;
      stencilRemaining = 0;
      const advance = stencilNext;
      stencilNext = undefined;
      advance?.();
    }, stencilRemaining);
  };
  const waitStencil = (milliseconds: number, advance: () => void): void => {
    win.clearTimeout(stencilTimer);
    stencilRemaining = milliseconds;
    stencilNext = advance;
    armStencil();
  };
  function visibility(): void {
    if (doc.hidden) {
      if (timer) {
        view.clearTimeout(timer);
        remaining = Math.max(0, deadline - view.performance.now());
        timer = 0;
      }
      if (stencilTimer) {
        view.clearTimeout(stencilTimer);
        stencilRemaining = Math.max(0, stencilDeadline - view.performance.now());
        stencilTimer = 0;
      }
    } else {
      arm();
      armStencil();
    }
  }
  function keydown(event: KeyboardEvent): void { if (event.key === "Escape") finish(); }
  function motionChange(): void { if (preference.matches) finish(); }
  const showCard = (name: string): void => {
    cards.forEach(card => card.classList.toggle("is-current", card.dataset.prerollCard === name));
  };
  const showWorld = (name: string): void => {
    const selected = worldPlates.find(plate => plate.dataset.prerollWorld === name);
    if (activeWorld === name) return;
    activeWorld = name;
    win.clearTimeout(stencilTimer);
    stencilTimer = 0;
    stencilNext = undefined;
    stencilRemaining = 0;
    if (worldLoad) worldPlates.forEach(plate => plate.removeEventListener("load", worldLoad!));
    worldLoad = undefined;
    stencil?.stop();
    stencil = undefined;
    worldStage?.classList.remove("is-stencilled");
    worldPlates.forEach(plate => plate.classList.remove("is-stencilled"));
    if (selected && !selected.hasAttribute("src") && selected.dataset.src) {
      selected.loading = "eager";
      selected.src = selected.dataset.src;
    }
    worldPlates.forEach(plate => plate.classList.toggle("is-current", plate === selected));
    if (!selected || !stencilCanvas) return;
    const currentStencil = createWorldStencil(stencilCanvas, selected);
    stencil = currentStencil;
    const holdFullColor = (prepared: boolean): void => {
      if (stopped || activeWorld !== name || stencil !== currentStencil) return;
      const gpuReady = prepared && currentStencil.ready();
      if (!selected.complete || !selected.naturalWidth) {
        worldLoad = (): void => {
          selected.removeEventListener("load", worldLoad!);
          worldLoad = undefined;
          holdFullColor(prepared);
        };
        selected.addEventListener("load", worldLoad, { once: true });
        return;
      }
      waitStencil(550, () => {
        if (stopped || activeWorld !== name || stencil !== currentStencil) return;
        worldStage?.classList.add("is-stencilled");
        selected.classList.add("is-stencilled");
        if (gpuReady) currentStencil.activate();
        hitWord();
      });
    };
    void currentStencil.prepare().then(holdFullColor);
  };
  const hitWord = (): void => {
    wordStage.classList.remove("is-changing");
    void wordStage.offsetWidth;
    wordStage.classList.add("is-changing");
    chrome ??= chromeCanvas ? createChromeText(chromeCanvas, word) : undefined;
    chrome?.refresh();
    chrome?.pulse();
  };
  const showPhrase = (index: number): void => {
    const [text, tone, duration] = phrases[index]!;
    const world = index < 2 ? "oz"
      : index < 6 || (index >= 10 && index <= 12) ? "wonderland"
        : "middle-earth";
    word.textContent = text;
    word.dataset.tone = tone;
    showWorld(world);
    hitWord();
    if (index < phrases.length - 1) wait(duration, () => showPhrase(index + 1));
    else wait(duration, showTagline);
  };
  const showTagline = (): void => {
    prefix.hidden = true;
    wordStage.hidden = true;
    chrome?.stop();
    chrome = undefined;
    tagline.hidden = false;
    wait(2600, finish);
  };

  root.hidden = false;
  root.inert = false;
  prefix.hidden = false;
  word.hidden = false;
  wordStage.hidden = false;
  wordStage.classList.remove("is-changing");
  word.textContent = phrases[0]![0];
  word.dataset.tone = phrases[0]![1];
  tagline.hidden = true;
  showCard("production");
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("keydown", keydown);
  skip.addEventListener("click", finish);
  motion.addEventListener("change", motionChange);
  skip.focus({ preventScroll: true });
  wait(5000, () => {
    showCard("presents");
    wait(5000, () => {
      showCard("words");
      showPhrase(0);
    });
  });
  return stop;
}
