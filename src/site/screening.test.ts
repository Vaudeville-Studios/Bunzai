/** Exercise the public auditorium's slideshow, opening replay and reduced-motion behavior. */
import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { sitePages } from './pages';
import { runScreening } from './screening';

function fixture(reduced = false, curtainMode: 'ready' | 'pending' | 'reject' = 'ready') {
  const dom = new JSDOM(sitePages([])[0]!.html, { pretendToBeVisual: true, url: 'https://example.test/Bunzai/' });
  const win = dom.window;
  const doc = win.document;
  let callback: (() => void) | undefined;
  let disconnected = false;
  const motion = new win.EventTarget();
  Object.assign(motion, { matches: reduced });
  Object.defineProperty(win, 'matchMedia', { value: () => motion });
  Object.defineProperty(win, 'setTimeout', { value: (fn: () => void) => { callback = fn; return 1; } });
  Object.defineProperty(win, 'clearTimeout', { value: () => { callback = undefined; } });
  Object.defineProperty(win, 'IntersectionObserver', { value: class {
    observe() {}
    disconnect() { disconnected = true; }
  } });
  const curtain = (): Promise<void> => curtainMode === 'pending' ? new Promise(() => {}) : curtainMode === 'reject' ? Promise.reject(new Error('Media failed')) : Promise.resolve();
  const stop = runScreening(doc, curtain);
  const current = (): HTMLElement => doc.querySelector<HTMLElement>('.screen-slide.is-current')!;
  const skipFilm = (): void => doc.querySelector<HTMLButtonElement>('[data-preroll-skip]')?.click();
  const enter = async (): Promise<void> => {
    doc.querySelector<HTMLButtonElement>('[data-screening-open]')!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    skipFilm();
  };
  return { dom, win, doc, motion, stop, enter, current, scheduled: () => !!callback, advance: () => { const fn = callback; callback = undefined; fn?.(); }, disconnected: () => disconnected };
}

test('click enters the auditorium, plays the recovered opening, then starts the feature slideshow', async () => {
  const f = fixture();
  expect(f.current().dataset.title).toBe('The opening title');
  expect(f.scheduled()).toBe(false);
  await f.enter();
  expect(f.doc.querySelector('.auditorium')!.getAttribute('data-screening-state')).toBe('showing');
  expect(f.current().dataset.title).toBe('Scenes');
  expect(f.doc.querySelector<HTMLOutputElement>('[data-screening-title]')!.value).toBe('Scenes');
  f.doc.querySelector<HTMLButtonElement>('[data-screen-step="-1"]')!.click();
  expect(f.current().dataset.title).toBe('The opening title');
  const stage = f.doc.querySelector<HTMLElement>('[data-screening]')!;
  stage.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(f.current()).toBe(f.doc.querySelector<HTMLElement>('[data-slide]:last-child')!);
  stage.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(f.current().dataset.title).toBe('The opening title');
  for (const slide of f.doc.querySelectorAll<HTMLElement>('[data-slide]')) expect(slide.inert).toBe(!slide.classList.contains('is-current'));
  f.stop();
  f.dom.window.close();
});

test('opening replay can be skipped without losing the current picture', async () => {
  const f = fixture();
  await f.enter();
  f.doc.querySelector<HTMLButtonElement>('[data-screen-go="2"]')!.click();
  const before = f.current().dataset.title;
  f.doc.querySelector<HTMLButtonElement>('[data-screening-replay]')!.click();
  expect(f.doc.querySelector<HTMLElement>('[data-screen-preroll]')!.hidden).toBe(false);
  f.doc.querySelector<HTMLButtonElement>('[data-preroll-skip]')!.click();
  expect(f.current().dataset.title).toBe(before);
  f.stop();
  f.dom.window.close();
});

test('slideshow keys cannot change the hidden picture during film; rejected curtain playback continues', async () => {
  const f = fixture(false, 'reject');
  f.doc.querySelector<HTMLButtonElement>('[data-screening-open]')!.click();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(f.doc.querySelector<HTMLElement>('[data-screen-preroll]')!.hidden).toBe(false);
  const stage = f.doc.querySelector<HTMLElement>('[data-screening]')!;
  stage.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(f.current().dataset.title).toBe('The opening title');
  f.doc.querySelector<HTMLButtonElement>('[data-preroll-skip]')!.click();
  expect(f.current().dataset.title).toBe('Scenes');
  f.stop();
  f.dom.window.close();
});

test('interaction, explicit pause, reduced motion, hidden tabs and cleanup cancel automatic playback', async () => {
  const f = fixture();
  const stage = f.doc.querySelector<HTMLElement>('[data-screening]')!;
  const play = f.doc.querySelector<HTMLButtonElement>('[data-screening-play]')!;
  await f.enter();
  stage.blur();
  expect(f.scheduled()).toBe(true);
  stage.dispatchEvent(new f.win.Event('mouseenter'));
  expect(f.scheduled()).toBe(false);
  stage.dispatchEvent(new f.win.Event('mouseleave'));
  expect(f.scheduled()).toBe(true);
  play.click();
  expect(f.scheduled()).toBe(false);
  expect(play.getAttribute('aria-pressed')).toBe('true');
  play.click();
  Object.assign(f.motion, { matches: true });
  f.motion.dispatchEvent(new f.win.Event('change'));
  expect(f.scheduled()).toBe(false);
  expect(play.disabled).toBe(true);
  Object.assign(f.motion, { matches: false });
  f.motion.dispatchEvent(new f.win.Event('change'));
  Object.defineProperty(f.doc, 'hidden', { value: true, configurable: true });
  f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
  expect(f.scheduled()).toBe(false);
  Object.defineProperty(f.doc, 'hidden', { value: false, configurable: true });
  f.doc.dispatchEvent(new f.win.Event('visibilitychange'));
  expect(f.scheduled()).toBe(true);
  f.stop();
  expect(f.scheduled()).toBe(false);
  expect(f.disconnected()).toBe(true);
  f.dom.window.close();
});

test('reduced motion skips the curtain and title sequence; stopping during curtain cannot resume later', async () => {
  const f = fixture(true);
  await f.enter();
  expect(f.doc.querySelector('.auditorium')!.getAttribute('data-screening-state')).toBe('showing');
  expect(f.current().dataset.title).toBe('Scenes');
  expect(f.scheduled()).toBe(false);
  f.stop(); f.dom.window.close();
  const g = fixture(false, 'pending');
  g.doc.querySelector<HTMLButtonElement>('[data-screening-open]')!.click();
  g.stop();
  await Promise.resolve();
  expect(g.doc.querySelector('.auditorium')!.getAttribute('data-screening-state')).toBe('entering');
  g.dom.window.close();
});
