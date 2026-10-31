/**
 * The website's only script: fetch the public release list from GitHub once, then fill every
 * [data-version] with the latest tag and every [data-news] list with releases in plain words. Built
 * with DOM text nodes only, so release text can never become markup. Offline or rate-limited, the
 * lists say so and point at GitHub. Also marks the visitor's platform on the download page and runs
 * the home page's reel: one act at a time, advancing on a timer that pauses on hover, on focus, off
 * screen, and for anyone who asked for reduced motion. The home page's curtain entrance is owned by curtain.ts.
 */
import { readReleasesList, type ReleaseInfo } from "../ui/_shared/version-history";
import { newsHeadline, visibleChanges } from "./news";
import { runCurtainIntro } from "./curtain";
import { runPremiere } from './premiere';
import { runSceneExamples } from './scene-example';
import { runScreening } from './screening';

const REPO = "https://github.com/Vaudeville-Studios/Bunzai";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

const day = (iso: string): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

function item(release: ReleaseInfo, full: boolean): HTMLLIElement {
  const li = el("li");
  const v = el("div", undefined, "v");
  v.append(el("b", release.version), day(release.date));
  const body = el("div");
  body.append(el("h3", newsHeadline(release)));
  const changes = visibleChanges(release.commits).slice(1, full ? 40 : 4);
  if (changes.length > 0) {
    const list = el("ul");
    for (const change of changes) list.append(el("li", change));
    if (full) body.append(list);
    else {
      const more = el("details");
      more.append(el("summary", `${changes.length} more change${changes.length === 1 ? "" : "s"}`), list);
      body.append(more);
    }
  }
  if (full && release.url) {
    const link = el("a", "Full notes on GitHub", "more");
    link.href = release.url;
    body.append(link);
  }
  li.append(v, body);
  return li;
}

function offline(list: Element): void {
  const li = el("li");
  const body = el("div");
  const link = el("a", "See every release on GitHub", "more");
  link.href = `${REPO}/releases`;
  body.append(el("p", "We could not reach GitHub just now."), link);
  li.append(el("div", undefined, "v"), body);
  list.replaceChildren(li);
}

async function fillReleases(): Promise<void> {
  const lists = document.querySelectorAll<HTMLElement>("[data-news]");
  const versions = document.querySelectorAll<HTMLElement>("[data-version]");
  if (lists.length === 0 && versions.length === 0) return;
  let releases: ReleaseInfo[] = [];
  try {
    const res = await fetch("https://api.github.com/repos/Vaudeville-Studios/Bunzai/releases?per_page=20", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.ok) releases = readReleasesList(await res.json());
  } catch {
    releases = [];
  }
  const latest = releases[0];
  if (latest) for (const v of versions) v.textContent = latest.version;
  for (const list of lists) {
    if (!latest) { offline(list); continue; }
    const full = list.dataset.news === "full";
    const limit = Number(list.dataset.limit) || releases.length;
    list.replaceChildren(...releases.slice(0, limit).map((r) => item(r, full)));
  }
}

function markPlatform(): void {
  const ua = navigator.userAgent;
  const mine = /Windows/.test(ua) ? "windows" : /Mac/.test(ua) ? "mac" : /Linux|X11/.test(ua) ? "linux" : "";
  if (mine) document.querySelector(`[data-os="${mine}"]`)?.classList.add("mine");
}

const ACT_MS = 9000; // one scene of the reel; matches the .prog fill animation in site.css

function runReel(root: HTMLElement): void {
  const slides = [...root.querySelectorAll<HTMLElement>(".slide")];
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-reel-go]")];
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let at = 0, timer = 0, held = false, seen = false;
  const schedule = (): void => {
    clearTimeout(timer);
    const running = seen && !held && !motion.matches && !document.hidden && document.documentElement.dataset.motion !== 'paused';
    root.classList.toggle("paused", !running);
    if (!running) return;
    // Resuming restarts the act, so the bar and the timer always agree.
    const bar = tabs[at]?.querySelector<HTMLElement>(".prog");
    if (bar) { bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = ""; }
    timer = window.setTimeout(() => show(at + 1), ACT_MS);
  };
  const show = (n: number): void => {
    at = (n + slides.length) % slides.length;
    slides.forEach((s, i) => { s.hidden = i !== at; });
    tabs.forEach((t, i) => { t.classList.toggle("on", i === at); t.setAttribute("aria-selected", String(i === at)); });
    root.style.setProperty("--accent", `var(--${slides[at]!.dataset.accent})`);
    const tab = tabs[at], strip = tab?.parentElement;
    if (tab && strip) strip.scrollTo({ left: tab.offsetLeft - strip.clientWidth / 2 + tab.clientWidth / 2, behavior: "smooth" });
    schedule();
  };
  tabs.forEach((t, i) => t.addEventListener("click", () => show(i)));
  root.querySelectorAll<HTMLElement>("[data-reel-step]").forEach((b) => b.addEventListener("click", () => show(at + Number(b.dataset.reelStep))));
  const hold = (on: boolean) => (): void => { held = on; schedule(); };
  root.addEventListener("mouseenter", hold(true));
  root.addEventListener("mouseleave", hold(false));
  root.addEventListener("focusin", hold(true));
  root.addEventListener("focusout", hold(false));
  document.addEventListener('site-motion-change', schedule);
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', schedule);
  new IntersectionObserver(([e]) => { seen = !!e && e.intersectionRatio > 0.4; schedule(); }, { threshold: [0, 0.4, 0.8] }).observe(root);
}

markPlatform();
const curtain = runCurtainIntro(document);
const stopPremiere = runPremiere(document, curtain.stop);
const stopScreening = runScreening(document, curtain.start);
window.addEventListener('pagehide', () => { stopScreening(); stopPremiere(); curtain.stop(); }, { once: true });
runSceneExamples(document);
document.querySelectorAll<HTMLElement>("[data-reel]").forEach(runReel);
void fillReleases();
