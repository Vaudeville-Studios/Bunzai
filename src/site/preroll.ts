/** Run the recovered Vaudeville title-card rhythm with one prop for each phrase. */
import { createWorldStencil } from './world-stencil';
import { createPaperSplatter } from './paper-splatter';

const PRELOAD_CONCURRENCY = 3;
const SYMBOL_HOLD_MS = 300;

export const SCREEN_PREROLL_PHRASES = [
  { text: "A STAGE", tone: "rose", duration: 1600, symbol: "oz", motion: ["translateY(-100%) rotate(-10deg)", "50% 0%", 150] },
  { text: "A STORY", tone: "gold", duration: 1550, symbol: "harry-potter", motion: ["rotateX(-78deg) translateY(18%)", "50% 0%", 135] },
  { text: "A DREAM", tone: "lilac", duration: 1500, symbol: "inception", motion: ["rotate(16deg) scale(.82)", "100% 50%", 120] },
  { text: "A SCENE", tone: "sky", duration: 1450, symbol: "phantom", motion: ["skewX(-18deg) translateX(-14%)", "0% 50%", 145] },
  { text: "A CANVAS", tone: "rose", duration: 1400, symbol: "howl-moving-castle", motion: ["translateX(105%) rotate(8deg)", "100% 50%", 130] },
  { text: "UNWRITTEN", tone: "mint", duration: 1350, symbol: "death-note", motion: ["rotateY(82deg) translateX(-12%)", "0% 50%", 155] },
  { text: "UNCHARTED", tone: "sky", duration: 1300, symbol: "uncharted", motion: ["translateX(-115%) skewY(12deg)", "0% 100%", 125] },
  { text: "WIDE OPEN", tone: "gold", duration: 1250, symbol: "one-piece", motion: ["rotate(-18deg) translateY(34%)", "100% 100%", 140] },
  { text: "BOUNDLESS", tone: "lilac", duration: 1200, symbol: "back-to-future", motion: ["scaleX(.72) translateX(18%)", "100% 50%", 110] },
  { text: "WAITING", tone: "mint", duration: 1150, symbol: "sleeping-beauty", motion: ["translateY(70%) rotateX(48deg)", "0% 100%", 160] },
  { text: "LISTENING", tone: "gold", duration: 1100, symbol: "little-mermaid", motion: ["skewY(16deg) translateX(18%)", "100% 0%", 135] },
  { text: "WATCHING", tone: "rose", duration: 1050, symbol: "lord-of-the-rings", motion: ["rotateY(-76deg) translateX(15%)", "100% 50%", 150] },
  { text: "WAKING", tone: "mint", duration: 1000, symbol: "matrix", motion: ["translateY(-115%) scaleY(.72)", "0% 0%", 120] },
  { text: "SHIFTING", tone: "lilac", duration: 1000, symbol: "transformers", motion: ["rotate(14deg) skewX(24deg)", "0% 100%", 145] },
  { text: "STIRRING", tone: "rose", duration: 1000, symbol: "beauty-and-beast", motion: ["translateX(92%) skewY(-18deg)", "100% 100%", 125] },
  { text: "READY", tone: "mint", duration: 1000, symbol: "hunger-games", motion: ["scale(.78) rotate(-10deg) translateY(14%)", "50% 100%", 115] },
  { text: "CALLING", tone: "gold", duration: 1000, symbol: "batman", motion: ["rotateX(72deg) translateY(-20%)", "0% 0%", 155] },
  { text: "CHANGING", tone: "lilac", duration: 1000, symbol: "sailor-moon", motion: ["translateX(-100%) rotate(-7deg) skewY(-10deg)", "0% 50%", 135] },
  { text: "ALIVE", tone: "sky", duration: 1000, symbol: "jurassic-park", motion: ["rotate(22deg) scaleX(.7) translateY(-18%)", "100% 0%", 150] },
  { text: "YOURS TO SHAPE", tone: "mint", duration: 1000, symbol: "minecraft", motion: ["translateY(110%) skewX(-22deg)", "50% 100%", 140] },
  { text: "YOURS TO DISCOVER", tone: "rose", duration: 1000, symbol: "zelda", motion: ["rotateY(68deg) scaleY(.82)", "0% 50%", 125] },
  { text: "YOURS TO EXPLORE", tone: "sky", duration: 1000, symbol: "star-trek", motion: ["translateX(112%) rotate(11deg)", "100% 0%", 155] },
  { text: "YOURS TO BUILD", tone: "gold", duration: 1000, symbol: "lego-movie", motion: ["skewX(42deg) translateY(22%)", "50% 0%", 110] },
  { text: "YOURS TO IMAGINE", tone: "lilac", duration: 1000, symbol: "neverending-story", motion: ["scaleY(.72) rotateX(-28deg)", "50% 0%", 145] },
  { text: "YOURS TO CREATE", tone: "lilac", duration: 1000, symbol: "fullmetal-alchemist", motion: ["rotate(-26deg) translateX(-16%)", "0% 100%", 135] },
  { text: "YOURS TO WRITE", tone: "mint", duration: 1000, symbol: "alan-wake", motion: ["translateY(-100%) skewX(18deg) scaleX(.82)", "100% 0%", 160] },
  { text: "YOURS TO BECOME", tone: "rose", duration: 1000, symbol: "pokemon", motion: ["rotateY(-72deg) translateY(14%)", "100% 100%", 120] },
  { text: "YOURS TO PLAY", tone: "gold", duration: 1000, symbol: "jumanji", motion: ["translateX(-108%) rotate(16deg)", "0% 0%", 150] },
  { text: "YOURS TO HOLD", tone: "lilac", duration: 1000, symbol: "frozen", motion: ["scaleX(.76) skewY(-16deg)", "50% 100%", 130] },
  { text: "YOURS TO TAKE", tone: "rose", duration: 1000, symbol: "pirates-caribbean", motion: ["rotateX(-70deg) skewX(14deg)", "0% 50%", 155] },
  { text: "YOURS TO CONQUER", tone: "gold", duration: 1000, symbol: "game-of-thrones", motion: ["translateY(100%) rotate(-9deg) scaleY(.76)", "100% 100%", 140] },
  { text: "YOURS", tone: "rose", duration: 2200, symbol: "bunzai-logo", motion: ["rotate(12deg) scale(.74) translateY(20%)", "50% 50%", 170] },
] as const;
type Phrase = typeof SCREEN_PREROLL_PHRASES[number];
type SymbolImage = { url: string; loaded: boolean };

function preloadSymbols(win: Window, slugs: readonly string[], progress: (done: number) => void) {
  const images = new Set<HTMLImageElement>();
  const cancelImage = new Map<HTMLImageElement, () => void>();
  let cancelled = false;
  let cursor = 0;
  let done = 0;
  const loaded = new Map<string, SymbolImage>();
  const urls = slugs.map(slug => [slug, slug === "bunzai-logo" ? "media/bunzai-mark.png" : `media/preroll-symbols/${slug}-v2.webp`] as const);
  const preloadOne = (slug: string, url: string): Promise<void> => new Promise(resolve => {
    const image = win.document.createElement("img");
    images.add(image);
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      images.delete(image);
      cancelImage.delete(image);
      loaded.set(slug, { url, loaded: ok && image.naturalWidth > 0 });
      done++;
      progress(done);
      resolve();
    };
    const timer = win.setTimeout(() => finish(false), 20000);
    cancelImage.set(image, () => finish(false));
    image.onload = () => { void image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0)); };
    image.onerror = () => finish(false);
    image.src = url;
    if (image.complete) void image.decode().then(() => finish(image.naturalWidth > 0), () => finish(image.naturalWidth > 0));
  });
  const worker = async (): Promise<void> => {
    while (!cancelled) {
      const item = urls[cursor++];
      if (!item) return;
      await preloadOne(...item);
    }
  };
  const promise = Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, urls.length) }, worker))
    .then(() => loaded);
  return {
    promise,
    cancel(): void {
      cancelled = true;
      for (const image of [...images]) {
        cancelImage.get(image)?.();
        image.removeAttribute("src");
      }
      images.clear();
    },
  };
}

function imageDecoded(image: HTMLImageElement): Promise<boolean> {
  if (image.complete && image.naturalWidth > 0) return image.decode().then(() => true, () => true);
  if (image.complete) return Promise.resolve(false);
  const view = image.ownerDocument.defaultView;
  if (!view) return Promise.resolve(false);
  return new Promise(resolve => {
    let timer = 0;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      view.clearTimeout(timer);
      image.removeEventListener("load", load);
      image.removeEventListener("error", error);
      image.removeEventListener("abort", error);
      resolve(ok);
    };
    const load = (): void => { void image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0)); };
    const error = (): void => finish(false);
    timer = view.setTimeout(error, 20000);
    image.addEventListener("load", load, { once: true });
    image.addEventListener("error", error, { once: true });
    image.addEventListener("abort", error, { once: true });
  });
}

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
  const symbolStage = root.querySelector<HTMLElement>("[data-preroll-symbol-stage]");
  const symbolImage = root.querySelector<HTMLImageElement>("[data-preroll-symbol]");
  const symbolCanvas = root.querySelector<HTMLCanvasElement>("[data-preroll-symbol-stencil]");
  const splatterCanvas = root.querySelector<HTMLCanvasElement>("[data-preroll-splatter]");
  const progress = root.querySelector<HTMLElement>("[data-preroll-progress]");
  const tagline = root.querySelector<HTMLElement>("[data-preroll-tagline]");
  if (cards.length !== 3 || !prefix || !word || !symbolStage || !symbolImage || !symbolCanvas || !splatterCanvas || !progress || !tagline) {
    onComplete(); return () => {};
  }
  const transition = view.getComputedStyle(cards[0]!).transitionDuration.split(",")[0]?.trim() ?? "0s";
  const cardCrossfadeMs = (Number.parseFloat(transition) || 0) * (transition.endsWith("ms") ? 1 : 1000);

  let timer = 0;
  let deadline = 0;
  let remaining = 0;
  let next: (() => void) | undefined;
  let stopped = false;
  let activeIndex = -1;
  const stencil = createWorldStencil(symbolCanvas, symbolImage);
  const splatter = createPaperSplatter(splatterCanvas);
  let preloadedCount = 0;
  const slugs = SCREEN_PREROLL_PHRASES.map(phrase => phrase.symbol);
  const preload = preloadSymbols(view, slugs, done => {
    preloadedCount = done;
    if (!progress.hidden) progress.textContent = `Preparing story symbols ${done} of ${slugs.length}`;
  });

  const cleanup = (): void => {
    view.clearTimeout(timer);
    timer = 0;
    next = undefined;
    preload.cancel();
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("keydown", keydown);
    skip.removeEventListener("click", finish);
    preference.removeEventListener("change", motionChange);
    stencil.stop();
    splatter.stop();
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
    deadline = view.performance.now() + remaining;
    timer = view.setTimeout(() => {
      timer = 0;
      remaining = 0;
      const advance = next;
      next = undefined;
      advance?.();
    }, remaining);
  };
  const wait = (milliseconds: number, advance: () => void): void => {
    view.clearTimeout(timer);
    remaining = milliseconds;
    next = advance;
    arm();
  };
  function visibility(): void {
    if (doc.hidden && timer) {
      view.clearTimeout(timer);
      remaining = Math.max(0, deadline - view.performance.now());
      timer = 0;
    } else if (!doc.hidden) arm();
  }
  function keydown(event: KeyboardEvent): void { if (event.key === "Escape") finish(); }
  function motionChange(): void { if (preference.matches) finish(); }
  const showCard = (name: string): void => {
    cards.forEach(card => card.classList.toggle("is-current", card.dataset.prerollCard === name));
  };
  const hitWord = (phrase: Phrase): void => {
    word.classList.remove("is-changing");
    word.style.setProperty("--word-entry-transform", phrase.motion[0]);
    word.style.setProperty("--word-entry-origin", phrase.motion[1]);
    word.style.setProperty("--word-entry-duration", `${phrase.motion[2]}ms`);
    void word.offsetWidth;
    word.classList.add("is-changing");
  };
  const impact = (index: number, phrase: Phrase, applyStencil: boolean, burst = true): void => {
    const style = view.getComputedStyle(symbolCanvas);
    const main = style.color;
    const shadow = style.borderTopColor;
    if (applyStencil) {
      symbolStage.classList.add("is-stencilled");
      stencil.activate(main, shadow);
    }
    if (burst) splatter.burst({ seed: index + 1, main, shadow });
    hitWord(phrase);
  };
  const showPhrase = (index: number, symbols: Map<string, SymbolImage>): void => {
    if (stopped) return;
    const phrase = SCREEN_PREROLL_PHRASES[index] as Phrase;
    const { text, tone, duration, symbol } = phrase;
    const asset = symbols.get(symbol);
    activeIndex = index;
    word.textContent = text;
    word.dataset.tone = tone;
    symbolStage.dataset.tone = tone;
    word.classList.remove("is-changing");
    symbolStage.classList.remove("is-current", "is-stencilled", "is-logo");
    symbolCanvas.hidden = false;
    symbolImage.hidden = false;
    if (symbol === "bunzai-logo") {
      stencil.stop();
      symbolCanvas.hidden = true;
      symbolImage.src = asset?.url ?? "media/bunzai-mark.png";
      symbolStage.classList.add("is-current", "is-logo");
      void imageDecoded(symbolImage).then(decoded => {
        if (stopped || activeIndex !== index) return;
        if (!decoded) progress.textContent = "The Bunzai mark could not be loaded; the phrase continues.";
        wait(SYMBOL_HOLD_MS, () => {
          if (stopped || activeIndex !== index) return;
          impact(index, phrase, false, decoded);
          wait(duration - SYMBOL_HOLD_MS, () => advancePhrase(index, symbols));
        });
      });
      return;
    }
    if (!asset?.loaded) {
      symbolImage.hidden = true;
      symbolCanvas.hidden = true;
      progress.hidden = false;
      progress.textContent = `The story symbol for ${text} could not be loaded; the phrase continues.`;
      wait(SYMBOL_HOLD_MS, () => { hitWord(phrase); wait(duration - SYMBOL_HOLD_MS, () => advancePhrase(index, symbols)); });
      return;
    }
    progress.hidden = true;
    symbolImage.src = asset.url;
    symbolStage.classList.add("is-current");
    void stencil.prepare().then(async prepared => {
      if (stopped || activeIndex !== index) return;
      const decoded = prepared || await imageDecoded(symbolImage);
      if (stopped || activeIndex !== index) return;
      wait(SYMBOL_HOLD_MS, () => {
        if (stopped || activeIndex !== index) return;
        impact(index, phrase, decoded);
        wait(duration - SYMBOL_HOLD_MS, () => advancePhrase(index, symbols));
      });
    });
  };
  const advancePhrase = (index: number, symbols: Map<string, SymbolImage>): void => {
    if (index + 1 < SCREEN_PREROLL_PHRASES.length) showPhrase(index + 1, symbols);
    else showTagline();
  };
  const showTagline = (): void => {
    splatter.stop();
    prefix.hidden = true;
    symbolStage.hidden = true;
    word.hidden = true;
    tagline.hidden = false;
    wait(2600, finish);
  };

  root.hidden = false;
  root.inert = false;
  prefix.hidden = false;
  symbolStage.hidden = false;
  symbolImage.hidden = false;
  symbolCanvas.hidden = false;
  word.hidden = false;
  word.classList.remove("is-changing");
  tagline.hidden = true;
  progress.hidden = true;
  showCard("production");
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("keydown", keydown);
  skip.addEventListener("click", finish);
  preference.addEventListener("change", motionChange);
  skip.focus({ preventScroll: true });
  wait(1800, () => {
    showCard("presents");
    wait(2200, () => {
      showCard("words");
      progress.hidden = false;
      progress.textContent = `Preparing story symbols ${preloadedCount} of ${slugs.length}`;
      void preload.promise.then(symbols => {
        if (!stopped) wait(cardCrossfadeMs, () => showPhrase(0, symbols));
      });
    });
  });
  return stop;
}
