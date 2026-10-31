/** Run the recovered Vaudeville title-card rhythm in the auditorium's native screen. */
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
  const tagline = root.querySelector<HTMLElement>("[data-preroll-tagline]");
  if (cards.length !== 3 || !prefix || !word || !tagline) { onComplete(); return () => {}; }

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

  const cleanup = (): void => {
    win.clearTimeout(timer);
    timer = 0;
    next = undefined;
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("keydown", keydown);
    skip.removeEventListener("click", finish);
    motion.removeEventListener("change", motionChange);
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
  const showPhrase = (index: number): void => {
    const [text, tone, duration] = phrases[index]!;
    word.textContent = text;
    word.dataset.tone = tone;
    word.classList.remove("is-changing");
    void word.offsetWidth;
    word.classList.add("is-changing");
    if (index < phrases.length - 1) wait(duration, () => showPhrase(index + 1));
    else wait(duration, showTagline);
  };
  const showTagline = (): void => {
    prefix.hidden = true;
    word.hidden = true;
    tagline.hidden = false;
    wait(2600, finish);
  };

  root.hidden = false;
  root.inert = false;
  prefix.hidden = false;
  word.hidden = false;
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
