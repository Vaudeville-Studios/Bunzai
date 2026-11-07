/**
 * Settings > Providers: which providers this studio can reach, and which of them new scenes start on.
 * A scene can switch to any model of a saved provider, so the model chosen here is only where it starts.
 *
 * THE SAME VAULT THE TERMINAL USES. A provider added here is a provider Kit sees, and one added
 * with Kit's /model shows up here. There is no second store, no second key to paste, and no way for
 * the two to disagree about which model is active.
 *
 * A KEY GOES IN AND NEVER COMES BACK. The field is empty even when editing a provider that has one,
 * because the server will not send a stored key to the browser at all - not masked, not truncated.
 * Blank therefore means "keep the one you have", which is what makes changing a model on a saved
 * provider not require finding the key again.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { AppContext } from "../../../app-contract";
import { apiFetchJson } from "../../../_shared/api-fetch";
import { toErrorMessage } from "../../../_shared/error-message";
import { protect } from "../../../_shared/protected-control";
import { SettingsRow, type SettingsSection } from "../section-contract";
import { Button } from "../../../components/button";
import { PROVIDER_GROUPS } from "../../../../kit/providers/spoke";
import { testProvider, testWords } from "./models-api";
import { MessageFormatField } from "./models-message-format";
import styles from "./models.module.css";
import {
  draftFrom,
  canListModels,
  draftProblem,
  emptyDraft,
  offeredModel,
  providerLabel,
  saveBody,
  type ProviderDraft,
  type ProviderKind,
  type SafeProvider,
} from "./models-core";

interface ListReply {
  providers: SafeProvider[];
  kinds: ProviderKind[];
  notice?: string;
}

/**
 * The picker's escape hatch, as a sentinel no real model id can collide with.
 *
 * A provider may publish no list, or the model somebody wants may be newer than the index the
 * provider serves. Neither is rare enough to make the list the only way through.
 */
const TYPE_IT = "__type_an_id__";

function ModelsSection({ ctx }: { ctx: AppContext }): JSX.Element {
  const [providers, setProviders] = useState<SafeProvider[]>([]);
  const [kinds, setKinds] = useState<ProviderKind[]>([]);
  const [notice, setNotice] = useState<string>();
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [models, setModels] = useState<{ id: string; label?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [modelProblem, setModelProblem] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, string>>({});
  /** Somebody chose "Type an id...", so the picker stands aside until the draft changes. */
  const [typing, setTyping] = useState(false);
  /** What the last lookup found, said beside the field it depended on. */
  const [listing, setListing] = useState<string | null>(null);
  /** The current lookup owns the picker; superseded requests cannot change it. */
  const modelRequest = useRef<AbortController | null>(null);
  /** The pending re-ask after the Base URL changes. */
  const refetch = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelModels = useCallback(() => {
    modelRequest.current?.abort();
    if (refetch.current) { clearTimeout(refetch.current); refetch.current = null; }
  }, []);
  useEffect(() => cancelModels, [cancelModels]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const reply = await apiFetchJson<ListReply>("/api/agent/providers");
      setProviders(reply.providers);
      setKinds(reply.kinds);
      // A vault that could not be recovered says so. Never swallowed: somebody whose saved
      // providers vanished needs to know why rather than finding an empty list.
      setNotice(reply.notice);
    } catch (error) {
      setProblem(toErrorMessage(error, "could not read the model list"));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const kindOf = (id: string): ProviderKind | undefined => kinds.find((k) => k.id === id);
  const editing = draft?.id ? providers.find((p) => p.id === draft.id) : undefined;
  /** The model is asked for once there is something to ask the provider with. */
  const modelsOpen = !!draft && (draft.id !== undefined || canListModels(draft, kindOf(draft.kind)) || modelProblem !== null);

  const save = async (): Promise<void> => {
    if (!draft) return;
    const why = draftProblem(draft, kindOf(draft.kind), editing?.hasKey ?? false);
    if (why) { setProblem(why); return; }
    setBusy(true);
    setProblem(null);
    try {
      await apiFetchJson("/api/agent/providers/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saveBody(draft)),
      });
      cancelModels();
      setModelProblem(null);
      setDraft(null);
      setModels([]);
      await reload();
      ctx.setStatus("provider saved");
    } catch (error) {
      setProblem(toErrorMessage(error, "could not save"));
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, id: string, then: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetchJson(`/api/agent/providers/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await reload();
      ctx.setStatus(then);
    } catch (error) {
      setProblem(toErrorMessage(error, "that did not work"));
    } finally {
      setBusy(false);
    }
  };

  /** A real call to the real endpoint: "saved" and "works" are different states. */
  const test = async (id: string): Promise<void> => {
    setTested((prior) => ({ ...prior, [id]: "asking..." }));
    try {
      const reply = await testProvider(id);
      setTested((prior) => ({ ...prior, [id]: testWords(reply) }));
    } catch (error) {
      setTested((prior) => ({ ...prior, [id]: toErrorMessage(error, "no answer") }));
    }
  };

  /**
   * Ask the provider what it offers, so the model is a choice rather than a string to get right.
   *
   * BY SAVED ID OR BY DRAFT KIND. Asking by id alone meant the list arrived only for a provider that
   * already existed, which is one screen too late: the model is chosen while ADDING one.
   */
  const loadModels = async (target: { id: string } | { kind: string; baseURL?: string; apiKey?: string; options?: Readonly<Record<string, string>> }): Promise<void> => {
    cancelModels();
    setListing(null);
    const controller = new AbortController();
    modelRequest.current = controller;
    setModelProblem(null);
    try {
      const reply = await apiFetchJson<{ models: { id: string; label?: string }[]; manual?: boolean }>(
        "/api/agent/providers/models",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target), signal: controller.signal },
      );
      if (controller.signal.aborted || modelRequest.current !== controller) return;
      if ("kind" in target) {
        setDraft((d) => (d && d.kind === target.kind ? { ...d, model: offeredModel(d.model, reply.models, kindOf(target.kind)?.defaultModel) } : d));
      }
      setModels(reply.models);
      setListing(reply.manual ? "This server doesn't list its models. Type one below." : `${reply.models.length} ${reply.models.length === 1 ? "model" : "models"} available.`);
    } catch {
      if (controller.signal.aborted) return;
      setModels([]);
      setModelProblem("Could not load this provider's models. Check the key and Base URL, or type a model ID.");
    }
  };

  const queueModels = (next: ProviderDraft): void => {
    if (next.id !== undefined) return;
    cancelModels();
    setModels([]);
    setListing(null);
    if (!canListModels(next, kindOf(next.kind))) return;
    refetch.current = setTimeout(() => void loadModels({ kind: next.kind, ...(next.apiKey.trim() ? { apiKey: next.apiKey.trim() } : {}), ...(next.baseURL.trim() ? { baseURL: next.baseURL.trim() } : {}), options: next.options }), 500);
  };

  return (
    <div {...protect("provider-keys")}>
      {notice && <p className={styles.notice}>{notice}</p>}

      <SettingsRow
        label="Providers"
        hint="Shared with Kit in the terminal. Adding one here adds it there."
      >
        <span />
      </SettingsRow>

      <ul className={styles.list}>
        {providers.length === 0 && <li className={styles.empty}>No providers connected yet.</li>}
        {providers.map(/* bounded-ok: fixed category set, per-item detail, capped or short by construction */ (p) => (
          <li key={p.id} className={p.active ? `${styles.row} ${styles.rowActive}` : styles.row}>
            <label className={styles.pick}>
              {/* A radio, because exactly one provider is active and that is worth looking like. */}
              <input
                type="radio"
                name="active-provider"
                checked={p.active}
                disabled={busy}
                onChange={() => { void act("activate", p.id, "provider switched"); }}
              />
              <span className={styles.name}>{providerLabel(p, kinds)}</span>
            </label>
            <span className={styles.model}>{p.model}</span>
            {/* Never the key. Only whether there is one. */}
            <span className={styles.key}>{p.hasKey ? "key saved" : "no key"}</span>
            <span className={styles.tested}>{tested[p.id] ?? ""}</span>
            <span className={styles.acts}>
              <Button size="sm" disabled={busy} onClick={() => { void test(p.id); }}>{"Test"}</Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => { setDraft(draftFrom(p, kindOf(p.kind))); setModels([]); setTyping(false); void loadModels({ id: p.id }); }}
              >
                {"Edit"}
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => { void act("remove", p.id, "provider removed"); }}>
                {"Remove"}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      {draft === null ? (
        <div className={styles.add}>
          <Button
            variant="primary"
            disabled={busy || kinds.length === 0}
            onClick={() => {
              const first = kinds[0];
              setDraft(emptyDraft(first));
              setModels([]);
              setTyping(false);
              // The add form opens already knowing what its first provider offers.
              if (first && canListModels(emptyDraft(first), first)) void loadModels({ kind: first.id });
              setListing(null);
            }}
          >
            {"Add a provider"}
          </Button>
        </div>
      ) : (
        <div className={styles.form}>
          <label>
            {"Provider"}
            <select
              value={draft.kind}
              // Changing provider resets the model to that provider's default: a model id from one
              // provider is meaningless on another, and carrying it over produces a saved entry
              // that only fails at the first turn.
              onChange={(e) => {
                const next = kindOf(e.target.value);
                setDraft({ ...draft, kind: e.target.value, model: next?.defaultModel ?? "" });
                setModels([]);
                setTyping(false);
                // Ask THIS provider what it offers, now, rather than after it has been saved. The
                // add screen is where the model is being decided, so it is where the list belongs.
                setListing(null);
                cancelModels();
                if (next && canListModels(emptyDraft(next), next)) void loadModels({ kind: e.target.value });
              }}
            >
              {PROVIDER_GROUPS.map(/* bounded-ok: fixed options, per-finding detail, or short word lists */ (group) => {
                const members = kinds.filter((k) => (k.group ?? "OpenAI compatible") === group);
                return members.length === 0 ? null : <optgroup key={group} label={group}>{members.map(/* bounded-ok: fixed options, per-finding detail, or short word lists */ (k) => <option key={k.id} value={k.id}>{k.label}</option>)}</optgroup>;
              })}
            </select>
          </label>

          {kindOf(draft.kind)?.needsBaseUrl && (
            <label>
              {"Base URL"}
              <input
                value={draft.baseURL}
                placeholder={kindOf(draft.kind)?.defaultBaseURL ? `${kindOf(draft.kind)!.defaultBaseURL} (leave blank for this)` : kindOf(draft.kind)?.baseUrlExample ?? "http://localhost:1234/v1"}
                onChange={(e) => {
                  const next = { ...draft, baseURL: e.target.value };
                  setDraft(next);
                  queueModels(next);
                }}
              />
              {kindOf(draft.kind)?.keyless && listing && <span className={styles.hint}>{listing}</span>}
            </label>
          )}

          {!kindOf(draft.kind)?.keyless && (
            <label>
              {"API key"}
              <input
                type="password"
                value={draft.apiKey}
                autoComplete="off"
                placeholder={editing?.hasKey ? "leave blank to keep the saved key" : kindOf(draft.kind)?.keyHint ?? "paste your key"}
                onChange={(e) => {
                  const next = { ...draft, apiKey: e.target.value };
                  setDraft(next);
                  queueModels(next);
                }}
              />
              {listing && <span className={styles.hint}>{listing}</span>}
            </label>
          )}

          {/*
            THE SPOKE'S OWN CHOICES, drawn from what it declares rather than hand-written here, so a
            spoke that adds one gets a control without anybody editing this file.

            This is the control that did not exist. The Claude subscription declares "Let Kit make
            changes this session", and without it that provider could only ever run read-only from
            this window - an agent that reads the whole studio, agrees the plan, and then cannot
            stage a single draft.
          */}
          {(kindOf(draft.kind)?.options ?? []).map(/* bounded-ok: fixed options, per-finding detail, or short word lists */ (option) => (
            <label key={option.key}>
              {option.label}
              <select
                value={draft.options[option.key] ?? option.defaultValue}
                onChange={(e) => {
                  const next = { ...draft, options: { ...draft.options, [option.key]: e.target.value } };
                  setDraft(next);
                  queueModels(next);
                }}
              >
                {option.choices.map(/* bounded-ok: fixed options, per-finding detail, or short word lists */ (c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          ))}

          {modelsOpen && (
            <>
              <label>
                {"Default model"}
                {/*
                  A PICKER WHEN THERE IS SOMETHING TO PICK FROM, and a text field when there is not.
                  The datalist this replaces was a picker only in principle: it renders as a plain text
                  box with a hint some browsers hide entirely, so the honest description of the old
                  behaviour is "type the id exactly and hope". A typo there is indistinguishable from an
                  outage at the first turn.

                  TYPING SURVIVES, which the old comment here was right to defend: a provider may publish
                  no list at all, or offer something newer than its own index. That is what "Type an
                  id..." is - the escape hatch made visible, rather than the only path.
                */}
                {models.length > 0 && !typing ? (
                  <select
                    value={draft.model}
                    onChange={(e) => {
                      if (e.target.value === TYPE_IT) { setTyping(true); return; }
                      setDraft({ ...draft, model: e.target.value });
                    }}
                  >
                    {/* A saved model the list does not carry stays selectable rather than being
                        silently swapped for whatever happens to sort first. */}
                    {!models.some((m) => m.id === draft.model) && draft.model && (
                      <option value={draft.model}>{`${draft.model} (saved)`}</option>
                    )}
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}
                    <option value={TYPE_IT}>{"Type an id..."}</option>
                  </select>
                ) : (
                  <input
                    value={draft.model}
                    placeholder={kindOf(draft.kind)?.defaultModel ?? "model id"}
                    onChange={(e) => { setDraft({ ...draft, model: e.target.value }); }}
                  />
                )}
                <span className={styles.hint}>{"New scenes start on this. Any scene can switch."}</span>
              </label>
            </>
          )}

          {/* Ollama speaks its own format. */}
          {kindOf(draft.kind)?.needsBaseUrl && draft.kind !== "ollama" && (
            <MessageFormatField value={draft.messageFormat} onChange={(messageFormat) => { setDraft({ ...draft, messageFormat }); }} />
          )}

          <label>
            {"Name (optional)"}
            <input
              value={draft.name}
              placeholder="Personal, Work"
              onChange={(e) => { setDraft({ ...draft, name: e.target.value }); }}
            />
          </label>

          <div className={styles.formActs}>
            <Button variant="primary" disabled={busy} onClick={() => { void save(); }}>{"Save"}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => { cancelModels(); setDraft(null); setProblem(null); setModelProblem(null); }}>
              {"Cancel"}
            </Button>
          </div>
        </div>
      )}

      {problem !== null && <p className={styles.problem}>{problem}</p>}
      {modelProblem !== null && <p role="status" className={styles.problem}>{modelProblem}</p>}
    </div>
  );
}

const section: SettingsSection = {
  id: "models",
  act: "agent",
  title: "The cast of providers",
  lede: "Which providers this studio can reach. Add one with its key, then pick any of its models in a scene. Shared with Kit in the terminal: adding one here adds it there.",
  protectedNote: "A key goes in and never comes back: the field is always empty, and blank means \"keep the one you have\". Host only.",
  label: "Providers",
  // Straight after appearance: it is the thing somebody comes to Settings to do once the studio
  // itself is set up, and burying it under Updates would be hiding the point of the agent window.
  order: 15,
  Component: ModelsSection,
};

export default section;
