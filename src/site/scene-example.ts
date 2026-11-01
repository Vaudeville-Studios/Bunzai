/** Scripted website conversations: local text-only input, reversible reading mode and bounded sample replies. */
export function runSceneExamples(doc: Document): void {
  const replies = [
    'Vera sets a second cup beside the lamp. “Tell me what brought you out in weather like this.”',
    'She listens as rain traces the glass. “Then we have until the storm passes to work it out.”',
    'The light sweeps across the water. Vera smiles. “There. A little less lost than before.”',
  ];
  doc.querySelectorAll<HTMLElement>('[data-scene-example]').forEach(root => {
    const log = root.querySelector<HTMLElement>('.scene-transcript')!;
    const form = root.querySelector<HTMLFormElement>('form')!;
    const input = form.querySelector<HTMLInputElement>('input')!;
    const submit = form.querySelector<HTMLButtonElement>('button')!;
    const reading = root.querySelector<HTMLButtonElement>('[data-reading-mode]')!;
    const initial = log.innerHTML;
    let turn = 0;
    const message = (speaker: string, text: string, yours: boolean): void => {
      const article = doc.createElement('div');
      article.className = `msg${yours ? ' you' : ''}`;
      article.style.setProperty('--c', yours ? 'var(--sky)' : 'var(--pink)');
      const avatar = doc.createElement('div');
      avatar.className = 'av';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = speaker[0]!;
      const body = doc.createElement('div');
      const name = doc.createElement('b');
      name.textContent = speaker;
      const p = doc.createElement('p');
      p.textContent = text;
      body.append(name, p);
      article.append(avatar, body);
      log.append(article);
    };
    reading.addEventListener('click', () => {
      const manuscript = root.classList.toggle('manuscript');
      reading.setAttribute('aria-pressed', String(manuscript));
      reading.textContent = manuscript ? 'Dialogue view' : 'Manuscript view';
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (turn >= replies.length) return;
      message('You', input.value.trim() || 'I was looking for a light.', true);
      message('Vera', replies[turn++]!, false);
      input.value = '';
      if (turn === replies.length) {
        input.disabled = submit.disabled = true;
        submit.textContent = 'End of example';
      }
      log.scrollTop = log.scrollHeight;
    });
    root.querySelector('[data-scene-reset]')!.addEventListener('click', () => {
      log.innerHTML = initial;
      turn = 0;
      input.disabled = submit.disabled = false;
      input.value = '';
      submit.textContent = 'Continue example \u2197';
      log.scrollTop = 0;
      input.focus({ preventScroll: true });
    });
  });
}
