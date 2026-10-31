/** Play the local curtain film only when the visitor enters the screening. */
export interface CurtainIntro {
  start(): Promise<void>;
  stop(): void;
}

export function runCurtainIntro(doc: Document): CurtainIntro {
  const root = doc.querySelector<HTMLElement>("[data-curtain-intro]");
  const video = root?.querySelector<HTMLVideoElement>("video");
  const skip = root?.querySelector<HTMLButtonElement>("[data-curtain-skip]");
  const win = doc.defaultView;
  let activeFinish: (() => void) | undefined;
  let active: Promise<void> | undefined;

  const start = (): Promise<void> => {
    if (!root || !video || !skip || !win) return Promise.resolve();
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    if (active) return active;

    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    active = promise;
    const siblings = [...doc.body.children].filter((node): node is HTMLElement => node instanceof win.HTMLElement && node !== root);
    const inert = siblings.map(node => node.inert);
    const priorFocus = doc.activeElement;
    let finished = false;
    let timeout = 0;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      win.clearTimeout(timeout);
      video.pause();
      root.hidden = true;
      doc.documentElement.classList.remove("curtain-active");
      doc.documentElement.classList.add("site-ready");
      doc.dispatchEvent(new win.Event("site-entrance-complete"));
      siblings.forEach((node, index) => { node.inert = inert[index]!; });
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("ended", finish);
      video.removeEventListener("error", finish);
      skip.removeEventListener("click", finish);
      doc.removeEventListener("keydown", keydown);
      motion.removeEventListener("change", motionChange);
      activeFinish = undefined;
      active = undefined;
      if (root.contains(doc.activeElement)) {
        if (priorFocus instanceof win.HTMLElement && priorFocus !== doc.body) priorFocus.focus({ preventScroll: true });
        else { const main = doc.querySelector<HTMLElement>("main"); if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }); } }
      }
      video.removeAttribute("src");
      video.querySelectorAll("source").forEach(source => source.removeAttribute("src"));
      video.load();
      resolve();
    };
    const update = (): void => {
      root.classList.toggle("zooming", video.currentTime >= 3.6);
      root.classList.toggle("revealing", video.currentTime >= 5.2);
    };
    const keydown = (event: KeyboardEvent): void => { if (event.key === "Escape") finish(); };
    const motionChange = (): void => { if (motion.matches) finish(); };
    const motion = win.matchMedia("(prefers-reduced-motion: reduce)");
    timeout = win.setTimeout(finish, 9000);
    activeFinish = finish;
    siblings.forEach(node => { node.inert = true; });
    doc.documentElement.classList.add("curtain-active");
    root.hidden = false;
    root.classList.remove("zooming", "revealing");
    skip.focus({ preventScroll: true });
    skip.addEventListener("click", finish);
    doc.addEventListener("keydown", keydown);
    motion.addEventListener("change", motionChange);
    video.addEventListener("timeupdate", update);
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    video.querySelectorAll<HTMLSourceElement>("source[data-src]").forEach(source => { source.src = source.dataset.src!; });
    video.muted = true;
    try {
      video.load();
      void video.play().catch(finish);
    } catch {
      finish();
    }
    return promise;
  };

  return { start, stop: () => activeFinish?.() };
}
