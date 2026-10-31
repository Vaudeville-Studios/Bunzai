/** Own the click-led curtain, recovered opening, and feature-picture screening. */
import { runScreenPreroll } from './preroll';

export function runScreening(doc: Document, startCurtain: () => Promise<void> = () => Promise.resolve()): () => void {
  const stage = doc.querySelector<HTMLElement>('[data-screening]');
  const win = doc.defaultView;
  if (!stage || !win) return () => {};
  const slides = [...stage.querySelectorAll<HTMLElement>('[data-slide]')];
  const dots = [...doc.querySelectorAll<HTMLButtonElement>('[data-screen-go]')];
  const title = doc.querySelector<HTMLOutputElement>('[data-screening-title]')!;
  const link = doc.querySelector<HTMLAnchorElement>('[data-screening-link]')!;
  const play = doc.querySelector<HTMLButtonElement>('[data-screening-play]')!;
  const replay = doc.querySelector<HTMLButtonElement>('[data-screening-replay]')!;
  const controls = doc.querySelector<HTMLElement>('.screening-controls')!;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const room = stage.closest<HTMLElement>('.auditorium')!;
  const open = stage.querySelector<HTMLButtonElement>('[data-screening-open]')!;
  const pictures = doc.querySelector<HTMLAnchorElement>('a[href="#screening"]');
  let opened = false, entering = false, playingFilm = false, disposed = false;
  let filmCleanup = (): void => {};
  let at = 0, timer = 0, paused = false, hovered = false, focused = false, visible = true;
  const schedule = (): void => {
    win.clearTimeout(timer);
    if (opened && !entering && !playingFilm && !paused && !hovered && !focused && visible && !doc.hidden && !motion.matches) timer = win.setTimeout(() => show(at + 1), 8000);
  };
  const playFilm = (returnTo: number): void => {
    win.clearTimeout(timer);
    playingFilm = true;
    controls.inert = true;
    filmCleanup = runScreenPreroll(doc, () => {
      if (disposed) return;
      playingFilm = false;
      controls.inert = false;
      show(returnTo, true);
      stage.focus({ preventScroll: true });
    });
  };
  const enterScreening = (event?: Event): void => {
    event?.preventDefault();
    if (opened) { if (!entering) show(1, true); return; }
    opened = true;
    entering = true;
    room.dataset.screeningState = 'entering';
    open.disabled = true;
    controls.inert = true;
    void Promise.resolve().then(startCurtain).catch(() => {}).then(() => {
      if (disposed) return;
      entering = false;
      room.dataset.screeningState = 'showing';
      playFilm(1);
    });
  };
  const show = (next: number, announce = false): void => {
    at = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('is-current', i === at);
      slide.inert = i !== at;
      slide.setAttribute('aria-hidden', String(i !== at));
    });
    dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === at)));
    title.setAttribute('aria-live', announce ? 'polite' : 'off');
    title.value = slides[at]!.dataset.title!;
    link.href = slides[at]!.dataset.link!;
    link.textContent = at === 0 ? 'About Bunzai \u2197' : 'Explore this part \u2197';
    schedule();
  };
  const updatePlay = (): void => {
    play.disabled = motion.matches;
    play.textContent = motion.matches ? 'Slideshow paused' : paused ? 'Play slideshow' : 'Pause slideshow';
    play.setAttribute('aria-pressed', String(paused || motion.matches));
    schedule();
  };
  const navigate = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-screen-go], [data-screen-step]');
    if (!button) return;
    show(button.dataset.screenGo !== undefined ? Number(button.dataset.screenGo) : at + Number(button.dataset.screenStep), true);
  };
  const replayOpening = (): void => { if (opened && !entering && !playingFilm) playFilm(at); };
  const toggle = (): void => { paused = !paused; updatePlay(); };
  const enter = (): void => { hovered = true; schedule(); };
  const leave = (): void => { hovered = false; schedule(); };
  const focus = (): void => { focused = true; schedule(); };
  const blur = (event: FocusEvent): void => {
    const target = event.relatedTarget as Node | null;
    focused = !!target && (stage.contains(target) || controls.contains(target));
    schedule();
  };
  const key = (event: KeyboardEvent): void => {
    if (!opened || entering || playingFilm) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); show(at + (event.key === 'ArrowRight' ? 1 : -1), true); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); show(event.key === 'Home' ? 0 : slides.length - 1, true); }
  };
  controls.addEventListener('click', navigate);
  controls.inert = true;
  open.addEventListener('click', enterScreening);
  pictures?.addEventListener('click', enterScreening);
  play.addEventListener('click', toggle);
  replay.addEventListener('click', replayOpening);
  for (const element of [stage, controls]) {
    element.addEventListener('mouseenter', enter);
    element.addEventListener('mouseleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    element.addEventListener('keydown', key);
  }
  doc.addEventListener('visibilitychange', schedule);
  doc.addEventListener('site-entrance-complete', schedule);
  motion.addEventListener('change', updatePlay);
  const observer = new win.IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; schedule(); });
  observer.observe(stage);
  updatePlay();
  return () => {
    disposed = true;
    win.clearTimeout(timer);
    filmCleanup();
    observer.disconnect();
    controls.removeEventListener('click', navigate);
    open.removeEventListener('click', enterScreening);
    pictures?.removeEventListener('click', enterScreening);
    play.removeEventListener('click', toggle);
    replay.removeEventListener('click', replayOpening);
    for (const element of [stage, controls]) {
      element.removeEventListener('mouseenter', enter);
      element.removeEventListener('mouseleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
      element.removeEventListener('keydown', key);
    }
    doc.removeEventListener('visibilitychange', schedule);
    doc.removeEventListener('site-entrance-complete', schedule);
    motion.removeEventListener('change', updatePlay);
  };
}
