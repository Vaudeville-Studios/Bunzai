/**
 * The editor's field-rendering ENGINE, lifted from Editor.tsx: the composite bodies (tags/rating/prose/
 * greetings/background/spotlight), the SubField primitive (renderSub), and controlFor - the one control
 * per FIELD_MODULES kind that every presenter renders through. They all thread the same draft/setField
 * state, so they come out together as a factory: makeControlFor(ctx) closes over the shell's draft,
 * setField, styles and the already-built gradient/palette/portrait bodies, and returns { controlFor,
 * proseBody } (proseBody is also used by the quiz's answerFor). Bodies are verbatim; only the ctx wrap
 * is new. Composite kinds live in field-control-composites.tsx.
 */
import { Button, Chip, IconButton } from "../../../components/button";
import type { JSX } from "react";
import { greetingsOf, str, type Greeting } from "../editor-derive";
import { readPath } from "../editor-core";
import { ExpandTextarea } from "../../../components/expand";
import { RenderBox } from "../../../components/render-box";
import { categorizeTag } from "../../../../core/tag-taxonomy";
import { TAG_CATEGORY_STYLE } from "../tag-category-style";
import { FIELD_MODULES, type FieldModule } from "../fields";
import { compositeControlFor } from "./field-control-composites";
import type { FieldCtx, FieldControlApi } from "./field-control-ctx";
import { recOr, strArray } from "../../../../core/guards";
import { CharacterTextControl } from "./character-text-control";

export type { FieldCtx, FieldControlApi } from "./field-control-ctx";

const SPOTLIGHT_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["description", "Description"],
  ["personality", "Personality"],
  ["scenario", "Scenario"],
  ["firstMessage", "First Message"],
  ["creatorNotes", "From the Creator"],
  ["systemPrompt", "System Prompt"],
];

export function makeControlFor(ctx: FieldCtx): FieldControlApi {
  const { draft, setField, styles, gradientBody, paletteBody, leftCard, inheritField, hasOverride, variantActive } = ctx;
  const text = (path: string): string => str(readPath(draft, path));

  const tagsControl = (
    <>
      <div className={styles.tagbar}>
        <Button size="sm" disabled title="The tagsheet taxonomy lands with the discovery milestone">Open Tagsheet</Button>
        <Button size="sm" disabled title="Auto-tag lands with the brain milestone">Auto-tag</Button>
      </div>
      <label className={styles.k}>{`selected tags (${strArray(readPath(draft, "discovery.tags")).length})`}</label>
      <div className={styles.tags}>
        {strArray(readPath(draft, "discovery.tags")).map(/* bounded-ok: tabs, ports, options, chips and per-item detail inside one document */ (tag) => {
          const cs = TAG_CATEGORY_STYLE[categorizeTag(tag)];
          return (
            <Chip
              key={tag}
              title={`Remove tag ${tag}`}
              onClick={() => setField("discovery.tags", strArray(readPath(draft, "discovery.tags")).filter((t) => t !== tag))}
              color={cs.color}
            >
              <span className={styles.tagIco}>{cs.icon}</span>
              {tag} <i>x</i>
            </Chip>
          );
        })}
        <input
          className={styles.tagIn}
          placeholder="+ tag, enter"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const value = e.currentTarget.value.trim();
            if (!value) return;
            const cur = strArray(readPath(draft, "discovery.tags"));
            if (!cur.includes(value)) setField("discovery.tags", [...cur, value]);
            e.currentTarget.value = "";
          }}
        />
      </div>
    </>
  );

  const ratingControl = (
    <div className={styles.rating}>
      <div className={styles.ratingRow}>
        <b>CONTENT RATING</b>
        <span className={styles.pill}>{text("discovery.rating") || "unrated"}</span>
        <i>auto-calc lands with the tagsheet</i>
      </div>
      <label className={styles.k}>override</label>
      <select className={styles.in} value={text("discovery.rating") || ""} onChange={(e) => setField("discovery.rating", e.target.value)}>
        <option value="">unrated</option>
        <option value="all-ages">all ages</option>
        <option value="mature">mature</option>
        <option value="explicit">explicit</option>
      </select>
    </div>
  );

  const baseBtn = (path: string): JSX.Element | null => {
    if (!variantActive || !inheritField || !hasOverride?.(path)) return null;
    return (
      <Button variant="quiet" size="sm" onClick={() => inheritField(path)} title="Remove this variant override and use the base value">Use base</Button>
    );
  };

  const proseBody = (id: string, path: string): JSX.Element => {
    const value = text(path);
    return (
      <>
        <CharacterTextControl field={FIELD_MODULES.find((m) => m.id === id) ?? { id, kind: "prose", sheetLabel: id }} value={value} onChange={(next) => setField(path, next)} styles={styles} />
        {baseBtn(path)}
      </>
    );
  };

  const greetingsBodyFor = (path: string): JSX.Element => {
    const rows = greetingsOf(draft, path);
    const setRows = (next: Greeting[]): void =>
      setField(path, next.filter((g) => g.text !== "" || (g.title ?? "") !== "" || g.id !== undefined));
    return (
      <>
        {rows.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (g, i) => (
          <div className={styles.greetRow} key={g.id ?? `greet-${i}`}>
            <div className={styles.greetHead}>
              <input
                className={styles.in}
                placeholder="optional title"
                value={g.title ?? ""}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value || undefined } : x)))}
              />
              <Button variant="danger" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
            </div>
            <RenderBox value={g.text} format="markdown">
              <ExpandTextarea
                grow
                label={g.title?.trim() || `Greeting ${i + 1}`}
                className={`${styles.in} ${styles.ta} ${styles.mono}`}
                // A greeting is prose somebody wrote and somebody else will read.
                spellCheck
                value={g.text}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
            </RenderBox>
          </div>
        ))}
        <Button size="sm" onClick={() => setRows([...rows, { text: "" }])}>+ Add a greeting</Button>
      </>
    );
  };

  const bgRef = text("presentation.background.ref");
  const backgroundBody = (
    <>
      {bgRef === "" ? (
        <div className={styles.bgempty}>No default background</div>
      ) : (
        <div className={styles.bgPreview} style={{ backgroundImage: `url("${bgRef}")` }} />
      )}
      <div className={styles.bgrow}>
        <span>Custom URL</span>
        <input
          className={styles.in}
          style={{ maxWidth: "12rem" }}
          placeholder="applied when starting a chat"
          value={bgRef}
          onChange={(e) => setField("presentation.background.ref", e.target.value)}
        />
      </div>
    </>
  );

  const spoilers = recOr(readPath(draft, "presentation.spoilers"));
  const spoilFields = recOr(spoilers.fields);
  const spoilOrder = ((): string[] => {
    const saved = strArray(spoilers.order).filter((k) => SPOTLIGHT_FIELDS.some(([key]) => key === k));
    const missing = SPOTLIGHT_FIELDS.map(([key]) => key).filter((k) => !saved.includes(k));
    return [...saved, ...missing];
  })();
  const moveSpoil = (key: string, dir: -1 | 1): void => {
    const at = spoilOrder.indexOf(key);
    const to = at + dir;
    if (to < 0 || to >= spoilOrder.length) return;
    const next = [...spoilOrder];
    [next[at], next[to]] = [next[to]!, next[at]!];
    setField("presentation.spoilers", { ...spoilers, order: next });
  };
  const spotlightBody = (
    <>
      {spoilOrder.map(/* bounded-ok: tabs, ports, options, chips and per-item detail inside one document */ (key) => {
        const label = SPOTLIGHT_FIELDS.find(([k]) => k === key)?.[1] ?? key;
        const on = spoilFields[key] === true;
        return (
          <div className={styles.spoilRow} key={key}>
            <span className={styles.ud}>
              <IconButton label={`Move ${label} up`} variant="quiet" size="sm" icon="lucide:arrow-up" onClick={() => moveSpoil(key, -1)} />
              <IconButton label={`Move ${label} down`} variant="quiet" size="sm" icon="lucide:arrow-down" onClick={() => moveSpoil(key, 1)} />
            </span>
            <span>{label}</span>
            <Chip
              onClick={() => setField("presentation.spoilers", { ...spoilers, fields: { ...spoilFields, [key]: !on } })}
              pressed={on}
            >
              {on ? "SPOILERED" : "visible"}
            </Chip>
          </div>
        );
      })}
    </>
  );

  const controlFor = (m: FieldModule): JSX.Element => {
    switch (m.kind) {
      case "text":
        return (
          <>
            <CharacterTextControl field={m} value={text(m.path)} onChange={(value) => setField(m.path, value)} styles={styles} />
            {baseBtn(m.path)}
          </>
        );
      case "prose": return proseBody(m.id, m.path);
      case "tags": return tagsControl;
      case "rating": return ratingControl;
      case "portrait": return <>{leftCard}</>;
      case "gradient": return gradientBody;
      case "palette": return paletteBody;
      case "greetings": return greetingsBodyFor(m.path);
      case "background": return backgroundBody;
      case "spotlight": return spotlightBody;
      default: {
        const composite = compositeControlFor(ctx, m, text);
        if (composite !== null) return composite;
        // Exhaustive for known kinds; unknown future kinds render nothing.
        return <></>;
      }
    }
  };

  return { controlFor, proseBody };
}
