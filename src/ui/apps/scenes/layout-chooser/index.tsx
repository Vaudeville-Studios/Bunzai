/**
 * The chat layout chooser: RoleCall's first-run chat appearance page (components/scene/ChatAppearanceChooser.tsx, copy kept
 * word for word minus "We will save it to your account.", which is untrue in a local app) with all six Bunzai layouts.
 * Full Chat is preselected; Preview opens the large view with a Choose button; Use hands the pick to onChoose.
 * The cards show real screenshots of one synthetic test scene in each layout (docs/media/chat-layouts/, 1920x947 like RoleCall's).
 * Look (wireframe design/wireframes/features/layout-chooser, header A): a centered marquee header under the title
 * screen's light rays without fog; hovering or focusing a card fills the page background with that layout's screenshot,
 * and the selected layout shows there otherwise.
 */
import { useState, type CSSProperties, type JSX } from "react";
import { docAssetUrl } from "../../../_shared/asset-url";
import { Ic } from "../../../_shared/ic";
import { DialogCore } from "../../../components/dialog-core";
import { LightRays } from "../../../components/light-rays";
import { Button, IconButton } from "../../../components/button";
import { LAYOUT_OPTIONS } from "../layout-options";
import type { ChatLayout } from "../chat-layout";
import styles from "./layout-chooser.module.css";

const CHOICES = LAYOUT_OPTIONS;
type Choice = (typeof CHOICES)[number];
const shotUrl = (choice: Choice): string => docAssetUrl(`docs/media/chat-layouts/${choice.image}.jpg`);

function Shot({ choice }: { choice: Choice }): JSX.Element {
  return (
    <img className={styles.shot} src={shotUrl(choice)} width={1920} height={947} alt={`${choice.title} layout in a test chat`} decoding="async" />
  );
}

export function LayoutChooser({ onChoose }: { onChoose: (layout: ChatLayout) => void }): JSX.Element {
  const [selected, setSelected] = useState<ChatLayout>("stage");
  const [hovered, setHovered] = useState<ChatLayout | null>(null);
  const [preview, setPreview] = useState<Choice | null>(null);
  const choice = CHOICES.find((c) => c.value === selected) ?? CHOICES[0]!;
  const shown = hovered ?? selected;

  return (
    <main className={styles.page} style={{ "--chooser-user": "var(--accent)", "--chooser-character": "var(--deck-character)" } as CSSProperties}>
      <div className={styles.backdrop} aria-hidden="true">
        {CHOICES.map((option) => <img key={option.value} src={shotUrl(option)} alt="" decoding="async" data-layout={option.value} data-shown={shown === option.value} />)}
      </div>
      <div className={styles.veil} aria-hidden="true" />
      <div className={styles.rays}><LightRays fog={false} /></div>
      <section className={styles.content} aria-labelledby="chat-layout-title">
        <header className={styles.marquee}>
          <p className={styles.kicker}>Bunzai · A space for your stories</p>
          <h1 id="chat-layout-title" className={styles.title}>Choose your <span>chat layout.</span></h1>
          <p className={styles.subtitle}>Same characters. Same stories. Your kind of stage.</p>
          <p>Choose a layout for all your chats. You can change it anytime in Appearance.</p>
        </header>
        <fieldset role="radiogroup" aria-label="Chat layout" className={styles.choices}>
          <legend className={styles.sr}>Chat layout</legend>
          {CHOICES.map((option, index) => (
            <article key={option.value} className={styles.card} data-selected={selected === option.value}
              onPointerEnter={() => setHovered(option.value)} onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(option.value)} onBlur={() => setHovered(null)}>
              <label className={styles.option}>
                <input className={styles.sr} type="radio" name="chat-layout" value={option.value} checked={selected === option.value} onChange={() => setSelected(option.value)} aria-label={option.title} />
                <span className={styles.heading}><span className={styles.number}>0{index + 1}</span><span className={styles.title}>{option.title}</span><span className={styles.check} aria-hidden="true">{selected === option.value && <Ic name="lucide:check" size={16} />}</span></span>
                <Shot choice={option} />
                <span className={styles.copy}><strong>{option.lead}</strong><span>{option.description}</span></span>
              </label>
              <div className={styles.previewRow}><Button variant="quiet" size="sm" icon="lucide:expand" onClick={() => setPreview(option)} aria-label={`Preview ${option.title}`}>Preview</Button></div>
            </article>
          ))}
        </fieldset>
        <p className={styles.caption}>Actual screenshots from a test chat. Every layout runs the same scene.</p>
        <footer className={styles.footer}>
          <p role="status">{choice.title} selected</p>
          <Button variant="primary" onClick={() => onChoose(selected)}>Use {choice.title}<Ic name="lucide:arrow-right" size={16} /></Button>
        </footer>
      </section>
      {preview && (
        <DialogCore placement="center" portal ariaLabel={`${preview.title} preview`} labelledBy="layout-preview-title" onDismiss={() => setPreview(null)} overlayClassName={styles.scrim} className={styles.dialog}>
          <div className={styles.dialogHeading}><h2 id="layout-preview-title" className={styles.title}>{preview.title}</h2><IconButton variant="quiet" label="Close preview" icon="lucide:x" onClick={() => setPreview(null)} /></div>
          <Shot choice={preview} />
          <p>{preview.description}</p>
          <div className={styles.dialogActions}><Button variant="primary" onClick={() => { setSelected(preview.value); setPreview(null); }}>Choose {preview.title}</Button></div>
        </DialogCore>
      )}
    </main>
  );
}
