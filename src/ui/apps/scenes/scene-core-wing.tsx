/** The rp-core wing: session Director and Compendium state with their saved on/off switches. */
import { useEffect, useState, type JSX } from "react";
import type { CoreSceneState } from "../../../studio/core-inspect";
import type { OpenScene } from "../../../studio/scenes";
import type { AppContext } from "../../app-contract";
import { Button } from "../../components/button";
import { SwitchRow } from "./context/memory-controls";
import { recOr, str } from "../../../core/guards";
import { toErrorMessage } from "../../../error-message";

const items = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(recOr) : [];

function Director({ data }: { data: CoreSceneState }): JSX.Element {
  const record = data.director;
  const state = recOr(record?.["state"]);
  const directive = recOr(record?.["directive"]);
  const pacing = recOr(state["pacing"]);
  const chapter = items(state["chapters"]).find((item) => item["id"] === state["currentChapterId"]);
  const collections = [
    { title: "Story arcs", entries: items(state["arcs"]) },
    { title: "Seeds", entries: items(state["seeds"]) },
    { title: "Hidden arcs", entries: items(state["invisibleArcs"]) },
    { title: "Notes", entries: items(state["notes"]) },
    { title: "Next intentions", entries: items(state["nextIntentions"]) },
  ];
  return <section className="mm-card" aria-label="rp-core Director">
    <div className="mm-sec">Director <small>rp-core</small></div>
    {!data.directorEnabled && <p className="mm-line box">The Director is off. Earlier plans remain available below.</p>}
    {!record ? <div className="mm-empty"><p>No Director plan has been committed on this take yet.</p></div> : <>
      <div className="mm-stats">
        <div><small>Turn</small><b>{String(record["turn"] ?? 0)}</b></div>
        <div><small>Result</small><b>{record["ok"] === true ? "Planned" : "No plan"}</b></div>
        <div><small>Mood</small><b>{str(pacing["currentMood"]) || "Unset"}</b></div>
      </div>
      {chapter && <div className="mm-text"><b>Current chapter: {str(chapter["title"])}</b><p>{str(chapter["premise"])}</p></div>}
      {str(directive["narrativeGoal"]) && <div className="mm-text"><b>Narrative goal</b><p>{str(directive["narrativeGoal"])}</p></div>}
      {collections.map(/* bounded-ok: exactly five fixed Director categories */ ({ title, entries }) => <div key={title} className="mm-text"><b>{title} · {entries.length}</b>
        {entries.length === 0 ? <p>Nothing recorded.</p> : entries.map(/* bounded-ok: checkState caps each Director list at four times its D-61 limit and state JSON at 128 KiB */ (entry, index) => <p key={str(entry["id"]) || index}>
          {str(entry["title"]) || str(entry["hint"]) || str(entry["content"]) || str(entry["description"]) || str(entry["name"]) || `Item ${index + 1}`}
          {title === "Seeds" && str(entry["payoff"]) && <small> · Payoff: {str(entry["payoff"])}</small>}
          {str(entry["status"]) && ` · ${str(entry["status"])}`}
        </p>)}
      </div>)}
    </>}
  </section>;
}

export function CoreWing({ ctx, scene }: { ctx: AppContext; scene: OpenScene }): JSX.Element {
  const [offset, setOffset] = useState(0);
  const [revision, refresh] = useState(0);
  const [data, setData] = useState<CoreSceneState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"director" | "memory" | null>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void ctx.api.getCoreSceneState(scene.chat.id, offset).then((value) => { if (active) setData(value); }, (cause: unknown) => { if (active) setError(toErrorMessage(cause, "Could not read rp-core state.")); });
    return () => { active = false; };
  }, [ctx.api, scene.chat.id, scene.branchVersion, offset, revision]);
  const toggle = async (feature: "director" | "memory", enabled: boolean): Promise<void> => {
    if (saving) return;
    setSaving(feature);
    try {
      const next = await ctx.api.setCoreSceneFeature(scene.chat.id, feature, enabled);
      setOffset(0);
      setData(next);
      setError("");
    } catch (cause) { setError(toErrorMessage(cause, "Could not change rp-core settings.")); }
    finally { setSaving(null); }
  };
  if (error) return <div className="wbody mm"><p role="alert">{error}</p><Button size="sm" onClick={() => refresh((n) => n + 1)}>Retry</Button></div>;
  if (!data) return <div className="wbody mm"><div className="mm-wait">Loading rp-core state...</div></div>;
  const memory = data.memory;
  return <div className="wbody mm" data-part="scene.core">
    <header className="hero"><div><div className="eb">Linked session</div><h2>rp-core <em>state</em></h2><p>Director and memory for this scene's core session.</p></div></header>
    <Button size="sm" onClick={() => refresh((n) => n + 1)}>Refresh</Button>
    <SwitchRow title="Director" checked={data.directorEnabled} disabled={saving !== null} onChange={() => void toggle("director", !data.directorEnabled)}
      description="Plan future replies with this scene's selected model." />
    <SwitchRow title="Memory" checked={data.memoryEnabled} disabled={saving !== null} onChange={() => void toggle("memory", !data.memoryEnabled)}
      description="Use rp-core Compendium entries in future turns. Turning it off keeps saved entries." />
    <Director data={data} />
    <section className="mm-card" aria-label="rp-core memory">
      <div className="mm-sec">Memory <small>rp-core Compendium</small></div>
      <div className="mm-stats"><div><small>Entries</small><b>{memory.total}</b></div><div><small>Queued</small><b>{memory.queued}</b></div><div><small>Parked</small><b>{memory.parked}</b></div></div>
      {memory.running && <p className="mm-line box">A memory task is running.</p>}
      {memory.items.length === 0 ? <div className="mm-empty"><p>No memory entries on this take yet.</p></div> : memory.items.map(/* bounded-ok: readCoreSceneState returns at most PAGE_SIZE 20 items */ (item) => <details className="mm-dis" key={item.ref}>
        <summary>{item.name} · {item.type}{item.retired ? " · retired" : ""}</summary>
        <div className="mm-dbody"><small>Source: {item.origin}</small><div className="mm-text"><p>{item.render}</p></div></div>
      </details>)}
      {memory.total > memory.items.length && <div className="mm-acts">
        <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
        <span>{offset + 1}-{Math.min(offset + memory.items.length, memory.total)} of {memory.total}</span>
        <Button size="sm" disabled={offset + memory.items.length >= memory.total} onClick={() => setOffset(offset + 20)}>Next</Button>
      </div>}
    </section>
  </div>;
}
