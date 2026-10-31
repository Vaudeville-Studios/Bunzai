/** The public auditorium markup, including its screened historical opening sequence. */
import { CAST } from './tour';

export function curtainIntroMarkup(): string {
  return `<div class="curtain-intro" data-curtain-intro hidden aria-label="Opening the Bunzai theater"><video muted playsinline preload="none" poster="media/curtain-closed.webp" aria-hidden="true"><source data-src="media/curtain-opening.webm" type="video/webm"><source data-src="media/curtain-opening.mp4" type="video/mp4"></video><div class="curtain-controls"><span>Bunzai</span><button class="btn" type="button" data-curtain-skip>Skip curtain opening</button></div></div>`;
}

export function auditoriumBody(): string {
  const pictures = CAST.flatMap(member => member.shots.slice(0, member.galleryShots ?? 1).map(([file, alt, copy], i) => ({ file, alt, name: i === 0 ? member.name : alt, title: copy?.title ?? member.title, intro: copy?.intro ?? member.intro, href: `tour/${member.id}.html` })));
  const dots = Array.from({ length: pictures.length + 1 }, (_, i) => `<button type="button" data-screen-go="${i}" aria-label="${i === 0 ? 'Opening title' : pictures[i - 1]!.name}" aria-pressed="${i === 0}"><span></span></button>`).join('');
  return `<section class="auditorium" data-screening-state="ready" aria-label="The Bunzai movie theater"><h1 class="cinema-accessible-title">Bunzai. All the worlds: your stage.</h1><div class="cinema-shell" id="screening" data-screening tabindex="0" aria-label="Bunzai picture slideshow">
<img class="cinema-art" src="media/cinema-auditorium.png" width="1672" height="941" alt="An inked crimson paper-cut theater with two foreground rows facing the screen" fetchpriority="high"><canvas class="cinema-light" data-stage-lights aria-hidden="true"></canvas><canvas class="cinema-projector" data-projector-lights aria-hidden="true"></canvas>
<div class="cinema-screen"><article class="screen-slide is-current screen-title" data-slide data-title="The opening title" data-link="info.html"><span>THE HOUSE IS YOURS.</span><p class="screen-wordmark" aria-hidden="true">BUN<em>ZAI</em></p><p>All the worlds: your stage</p><p class="screen-introduction">Make characters, build their worlds, and play stories with an AI provider you choose.</p><button class="btn" type="button" data-screening-open>Begin the showing <span aria-hidden="true">&#8599;</span></button></article>
<div class="screen-preroll" data-screen-preroll hidden aria-label="Bunzai opening film">
<article class="screen-preroll-card is-current" data-preroll-card="production"><span>AN INDEPENDENT PRODUCTION</span><strong class="screen-wordmark">BUN<em>ZAI</em></strong></article>
<article class="screen-preroll-card" data-preroll-card="presents"><p class="screen-preroll-type">VAUDEVILLE PRESENTS</p></article>
<article class="screen-preroll-card screen-preroll-words" data-preroll-card="words">
<div class="screen-preroll-content">
<div class="screen-preroll-symbol-stage" data-preroll-symbol-stage aria-hidden="true"><img class="screen-preroll-symbol" data-preroll-symbol alt="" decoding="async"><canvas class="screen-preroll-symbol-stencil" data-preroll-symbol-stencil></canvas></div>
<div class="screen-preroll-copy"><span class="screen-preroll-prefix" data-preroll-prefix>ALL THE WORLD'S</span><strong class="screen-preroll-word" data-preroll-word data-tone="rose"></strong><p class="screen-preroll-progress" data-preroll-progress role="status" hidden></p></div>
</div>
<p class="screen-preroll-tagline" data-preroll-tagline hidden>All the worlds: your stage</p></article>
<button class="screen-preroll-skip" type="button" data-preroll-skip>Skip opening</button>
</div>
${pictures.map(picture => `<figure class="screen-slide screen-feature" data-slide data-title="${picture.name}" data-link="${picture.href}" inert aria-hidden="true"><a class="screen-picture" href="media/${picture.file}" target="_blank" rel="noopener" aria-label="Open full-resolution image: ${picture.alt}"><img src="media/${picture.file}" alt="${picture.alt}" loading="lazy" decoding="async"><span class="screen-enlarge">Enlarge image &#8599;</span></a><figcaption><span class="screen-kicker">INSIDE BUNZAI</span><h2>${picture.title}</h2><p>${picture.intro}</p><span class="screen-picture-label">ON SCREEN</span><p class="screen-picture-description">${picture.alt}</p><a href="${picture.href}">Take a closer look <span aria-hidden="true">&#8599;</span></a></figcaption></figure>`).join('')}
</div></div>
<div class="cinema-floor"><div class="screening-caption"><span>NOW SHOWING</span><output data-screening-title>The opening title</output><a data-screening-link href="info.html">About Bunzai &#8599;</a></div><div class="screening-controls" role="group" aria-label="Picture slideshow controls"><button type="button" data-screen-step="-1" aria-label="Previous picture">&#8592;</button><div class="screening-dots">${dots}</div><button type="button" data-screen-step="1" aria-label="Next picture">&#8594;</button><button type="button" class="screening-play" data-screening-play aria-pressed="false">Pause slideshow</button><button type="button" data-screening-replay>Replay opening</button></div><button class="cinema-motion" type="button" data-pause-motion aria-pressed="false">Pause lighting</button></div>
<div class="cinema-footer"><span>FREE &amp; OPEN SOURCE</span><p>Characters, worlds, and stories.<br>An AI provider you choose.</p><a href="download.html">Get Bunzai &#8599;</a></div></section>`;
}
