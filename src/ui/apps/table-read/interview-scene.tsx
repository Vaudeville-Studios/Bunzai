/** Generated paper-cut scene partner and table, with interview-state-driven pose and light. */
import type { JSX } from "react";
import type { ReaderArt } from "./reader-art";
import table from "./table.png";
import styles from "./scene.module.css";

export function InterviewScene({ pending, questionId, reader }: { pending: boolean; questionId?: string; reader: ReaderArt }): JSX.Element {
  return <div className={styles.art} aria-hidden="true" data-pending={pending || undefined} data-part="table-read.scene.art">
    <div className={styles.spotlight} />
    <img className={styles.figure} src={reader.image} alt="" />
    <div className={styles.nameplate}>The Understudy<span>Your scene partner</span></div>
    <img className={styles.table} src={table} alt="" />
    <svg key={questionId} className={styles.papers} viewBox="0 0 150 90">
      <g className={styles.manuscript}><path className={styles.paper} d="m20 8 110 8-7 64L11 70Z" /><path className={styles.hatch} d="m35 26 68 5m-70 8 75 5m-77 8 63 5m-64 8 40 3" /></g>
    </svg>
  </div>;
}
