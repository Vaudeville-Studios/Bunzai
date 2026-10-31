/** Purpose: show only bounded host-produced operation review values as inert text and definition rows. */
import type { JSX, ReactNode } from "react";
import { decodeJsonValue, type JsonValue } from "../../extensions/contracts/value";
import styles from "./effect-review.module.css";

function node(value: JsonValue, label: string): ReactNode {
  if (value === null || typeof value !== "object") return <p className={styles.value}><strong>{label}</strong><span>{String(value)}</span></p>;
  if (Array.isArray(value)) return <section className={styles.group}><h5>{label}</h5><ul>{value.map(/* bounded-ok: shared JSON decoder enforces aggregate value limits */ (item, index) => <li key={index}>{node(item, `Item ${index + 1}`)}</li>)}</ul></section>;
  return <section className={styles.group}><h5>{label}</h5><dl>{Object.entries(value).map(/* bounded-ok: shared JSON decoder enforces aggregate value limits */ ([key, item]) => <div key={key}><dt>{key}</dt><dd>{node(item, key)}</dd></div>)}</dl></section>;
}

export function EffectReview({ value }: { value: unknown }): JSX.Element {
  return <div className={styles.review}>{node(decodeJsonValue(value), "Review details")}</div>;
}
