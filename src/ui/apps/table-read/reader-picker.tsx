/** Shared appearance-only reader picker for setup and the ongoing interview. */
import { useId, type JSX } from "react";
import { Card } from "../../components/button";
import { Select } from "../../components/rc-controls";
import { READER_ART, readerArt, type ReaderArt } from "./reader-art";
import styles from "./styles.module.css";

export function ReaderPicker({ value, onChange, compact = false }: { value: ReaderArt; onChange(value: ReaderArt): void; compact?: boolean }): JSX.Element {
  const id = useId();
  if (compact) return <div className={styles.readerSelect} data-part="table-read.reader.compact">
    <label htmlFor={id}>Reader appearance</label>
    <Select id={id} value={value.id} onChange={(event) => onChange(readerArt(event.target.value))}>
      {READER_ART.map(/* bounded-ok: finite bundled reader artwork */ (reader) => <option key={reader.id} value={reader.id}>{reader.label}</option>)}
    </Select>
  </div>;
  return <section data-part="table-read.reader">
    <h2 className={styles.heading}>Choose your scene partner's appearance</h2>
    <p className={styles.muted}>This changes the illustration. The Understudy and your selected model stay the same.</p>
    <div className={styles.readerGrid}>
      {READER_ART.map(/* bounded-ok: finite bundled reader artwork */ (reader) => <Card key={reader.id} kind="art" vars={{ "--card-aspect": "5 / 6" }} heading={reader.label} kicker={value.id === reader.id ? "Selected" : undefined} selected={value.id === reader.id} aria-pressed={value.id === reader.id} aria-label={reader.label} onClick={() => onChange(reader)} art={<img className={styles.readerPortrait} src={reader.image} alt="" />} data-part="table-read.reader.choice" />)}
    </div>
  </section>;
}
