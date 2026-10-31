/** Run the recovered Vaudeville title-card rhythm with one prop for each phrase. */
import { createWorldStencil } from './world-stencil';

const PRELOAD_CONCURRENCY = 3;
const SYMBOL_HOLD_MS = 300;

export const SCREEN_PREROLL_PHRASES = [
  ["A STAGE", "rose", 1600, "oz"], ["A STORY", "gold", 1550, "harry-potter"],
  ["A DREAM", "lilac", 1500, "inception"], ["A SCENE", "sky", 1450, "phantom"],
  ["A CANVAS", "rose", 1400, "howl-moving-castle"], ["UNWRITTEN", "mint", 1350, "death-note"],
  ["UNCHARTED", "sky", 1300, "uncharted"], ["WIDE OPEN", "gold", 1250, "one-piece"],
  ["BOUNDLESS", "lilac", 1200, "back-to-future"], ["WAITING", "mint", 1150, "sleeping-beauty"],
  ["LISTENING", "gold", 1100, "little-mermaid"], ["WATCHING", "rose", 1050, "lord-of-the-rings"],
  ["WAKING", "mint", 1000, "matrix"], ["SHIFTING", "lilac", 1000, "transformers"],
  ["STIRRING", "rose", 1000, "beauty-and-beast"], ["READY", "mint", 1000, "hunger-games"],
  ["CALLING", "gold", 1000, "batman"], ["CHANGING", "lilac", 1000, "sailor-moon"],
  ["ALIVE", "sky", 1000, "jurassic-park"], ["YOURS TO SHAPE", "mint", 1000, "minecraft"],
  ["YOURS TO DISCOVER", "rose", 1000, "zelda"], ["YOURS TO EXPLORE", "sky", 1000, "star-trek"],
  ["YOURS TO BUILD", "gold", 1000, "lego-movie"], ["YOURS TO IMAGINE", "lilac", 1000, "neverending-story"],
  ["YOURS TO CREATE", "lilac", 1000, "fullmetal-alchemist"], ["YOURS TO WRITE", "mint", 1000, "alan-wake"],
  ["YOURS TO BECOME", "rose", 1000, "pokemon"], ["YOURS TO PLAY", "gold", 1000, "jumanji"],
  ["YOURS TO HOLD", "lilac", 1000, "frozen"], ["YOURS TO TAKE", "rose", 1000, "pirates-caribbean"],
  ["YOURS TO CONQUER", "gold", 1000, "game-of-thrones"], ["YOURS", "rose", 2200, "bunzai-logo"],
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
  const urls = slugs.map(slug => [slug, slug === "bunzai-logo" ? "media/bunzai-mark.png" : `media/preroll-symbols/${slug}-v1.webp`] as const);
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
  const progress = root.querySelector<HTMLElement>("[data-preroll-progress]");
  const tagline = root.querySelector<HTMLElement>("[data-preroll-tagline]");
  if (cards.length !== 3 || !prefix || !word || !symbolStage || !symbolImage || !symbolCanvas || !progress || !tagline) {
    onComplete(); return () => {};
  }

  let timer = 0;
  let deadline = 0;
  let remaining = 0;
  let next: (() => void) | undefined;
  let stopped = false;
  let activeIndex = -1;
  const stencil = createWorldStencil(symbolCanvas, symbolImage);
  let preloadedCount = 0;
  const slugs = SCREEN_PREROLL_PHRASES.map(phrase => phrase[3]);
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
  const hitWord = (): void => {
    word.classList.remove("is-changing");
    void word.offsetWidth;
    word.classList.add("is-changing");
  };
  const showPhrase = (index: number, symbols: Map<string, SymbolImage>): void => {
    if (stopped) return;
    const [text, tone, duration, slug] = SCREEN_PREROLL_PHRASES[index] as Phrase;
    const asset = symbols.get(slug);
    activeIndex = index;
    word.textContent = text;
    word.dataset.tone = tone;
    word.classList.remove("is-changing");
    symbolStage.classList.remove("is-current", "is-stencilled", "is-logo");
    symbolCanvas.hidden = false;
    symbolImage.hidden = false;
    if (slug === "bunzai-logo") {
      stencil.stop();
      symbolCanvas.hidden = true;
      symbolImage.src = asset?.url ?? "media/bunzai-mark.png";
      symbolStage.classList.add("is-current", "is-logo");
      void imageDecoded(symbolImage).then(decoded => {
        if (stopped || activeIndex !== index) return;
        if (!decoded) progress.textContent = "The Bunzai mark could not be loaded; the phrase continues.";
        wait(SYMBOL_HOLD_MS, () => {
          if (stopped || activeIndex !== index) return;
          hitWord();
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
      wait(SYMBOL_HOLD_MS, () => { hitWord(); wait(duration - SYMBOL_HOLD_MS, () => advancePhrase(index, symbols)); });
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
        if (decoded) stencil.activate();
        symbolStage.classList.add("is-stencilled");
        hitWord();
        wait(duration - SYMBOL_HOLD_MS, () => advancePhrase(index, symbols));
      });
    });
  };
  const advancePhrase = (index: number, symbols: Map<string, SymbolImage>): void => {
    if (index + 1 < SCREEN_PREROLL_PHRASES.length) showPhrase(index + 1, symbols);
    else showTagline();
  };
  const showTagline = (): void => {
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
      void preload.promise.then(symbols => { if (!stopped) showPhrase(0, symbols); });
    });
  });
  return stop;
}
