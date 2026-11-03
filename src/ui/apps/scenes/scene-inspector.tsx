/**
 * The Prompt Inspector's review dialog, as RoleCall's ModelCallReviewGate draws it: the title, a token chip, "Before send",
 * the exact request, and the choices. Each message is editable here; Send goes on with the changed ones (RoleCall's
 * "Edit and send"), "Review later" (also Esc, the X, or a click outside) dismisses it and the turn stays paused behind
 * RoleCall's amber "Turn paused for Prompt Inspector" pill (AuthoritativeModelCallReviewOverlay.tsx), which reopens it;
 * "Stop turn" or the scene's Stop ends the turn with nothing kept (rc-parity 03 F16).
 * The request is the one the turn built (studio/scene-turn.ts), shown, never re-formatted. When the reply may call tools, their
 * definitions follow the messages, read-only: they are sent as the request's tool fields, not as text anyone could edit.
 */
import { useEffect, useState, type JSX } from "react";
import { Button, IconButton } from "../../components/button";
import { protect } from "../../_shared/protected-control";
import { InkDialog } from "../../components/ink-dialog";
import { editsOf } from "./inspector-core";
import { OPEN_REVIEW } from "./context/review-open";
import type { RequestParams } from "../../../studio/scene-turn-trace";
import type { Review } from "./use-scene-turn";
import { VirtualRows } from "../../_shared/virtual-list";

const MESSAGE_ROW_PX = 96;

const WHY: Record<string, string> = { unsupported: "this provider does not take it", neutral: "it is at its no-op value", "parent-off": "the setting it belongs to is off", unusable: "its value cannot be used here" };

/** The parameters going out with the request, read-only: the fields sent under their wire names, what was left out and why, and the custom text. */
function RequestParamsView({ params }: { params: RequestParams }): JSX.Element | null {
  const sent = Object.keys(params.sent).length > 0;
  if (!sent && params.notSent.length === 0 && !params.customBody && !params.customExclude && !params.customHeaderNames?.length) return null;
  const custom = { ...(params.customHeaderNames?.length ? { headers: params.customHeaderNames } : {}), ...(params.customBody ? { body: params.customBody } : {}), ...(params.customExclude ? { remove: params.customExclude.split("\n").filter(Boolean) } : {}) };
  return (
    <label className="pi-msg" data-part="scene.inspector.params">
      <span>request parameters</span>
      <textarea readOnly rows={6} value={JSON.stringify({ sent: params.sent, ...(Object.keys(custom).length > 0 ? { custom } : {}), notSent: params.notSent.map((n) => `${n.id}: ${WHY[n.why] ?? n.why}`) }, null, 2)} />
    </label>
  );
}

export function PromptInspector({ review, onAnswer }: { review: Review; onAnswer(answer: { kind: "send"; edits: Record<number, string> } | { kind: "cancel" }): Promise<void> }): JSX.Element {
  const [drafts, setDrafts] = useState(() => review.messages.map((m) => m.content));
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // The Context wing's Review tile (RoleCall: openModelCallReview) brings a dismissed review back.
  useEffect(() => {
    const open = (e: Event): void => { (e as CustomEvent<{ handled: boolean }>).detail.handled = true; setDismissed(false); };
    window.addEventListener(OPEN_REVIEW, open);
    return () => window.removeEventListener(OPEN_REVIEW, open);
  }, []);
  const edits = editsOf(review.messages, drafts);
  const changed = Object.keys(edits).length;
  const answer = (next: Parameters<typeof onAnswer>[0]): void => { setBusy(true); void onAnswer(next).finally(() => setBusy(false)); };
  const later = (): void => { if (!busy) setDismissed(true); };
  if (dismissed) return <div className="pi-paused"><Button block tone="var(--stage-warn)" onClick={() => setDismissed(false)}>Turn paused for Prompt Inspector</Button></div>;
  return (
    <InkDialog onDismiss={later} ariaLabel="Prompt Inspector" sheetClassName="pi-sheet">
      <div className="pi" data-part="scene.inspector">
        <header className="pi-top">
          <h2>Prompt Inspector</h2>
          <span className="pi-chip">about {review.tokens.toLocaleString()} tokens</span>
          <span className="pi-chip">Before send</span>
          <IconButton variant="quiet" size="sm" label="Close Prompt Inspector" icon="lucide:x" onClick={later} />
        </header>
        {review.mediaEstimateIncomplete && <p className="pi-media-note">This text estimate excludes image and PDF token costs.</p>}
        <div className="pi-body">
          <VirtualRows items={review.messages} keyOf={(_, i) => String(i)} estimate={MESSAGE_ROW_PX} gap={10} render={(m, i) => (
            <label className="pi-msg">
              <span>{m.role}</span>
              {review.files?.filter((file) => file.message === i).map(/* bounded-ok: request projection admits at most 32 prompt files */ (file) => <span key={`${file.kind}:${file.name}`}>{file.owner ? `${file.owner}: ` : ""}{file.name} · {file.kind}</span>)}
              <textarea value={drafts[i]} rows={Math.min(12, Math.max(2, (drafts[i] ?? "").split("\n").length))} disabled={busy} onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))} />
            </label>
          )} />
          {review.tools?.map(/* bounded-ok: tool list of one review */ (t) => (
            <label key={t.name} className="pi-msg" data-part="scene.inspector.tool">
              <span>tool: {t.name}</span>
              <textarea readOnly value={JSON.stringify({ description: t.description, parameters: t.parameters }, null, 2)} rows={6} />
            </label>
          ))}
          {review.params && <RequestParamsView params={review.params} />}
        </div>
        <footer {...protect("inspector-actions", "pi-acts")}>
          <Button variant="quiet" disabled={busy} onClick={later}>Review later</Button>
          <Button variant="danger" disabled={busy} onClick={() => answer({ kind: "cancel" })}>Stop turn</Button>
          <Button variant="primary" icon="lucide:chevron-right" disabled={busy} onClick={() => answer({ kind: "send", edits })}>{changed > 0 ? "Edit and send" : "Send"}</Button>
        </footer>
      </div>
    </InkDialog>
  );
}
