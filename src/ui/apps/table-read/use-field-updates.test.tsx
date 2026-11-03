/** Accepted field feedback ignores loading/polls and resets on the app's actual library lifetime. */
import { expect, jest, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDom } from "../../_shared/test-dom";
import { newInterview } from "../../../core/table-read/interview";
import { setCharacterField } from "../../../core/table-read/fields";
import type { TableReadSession } from "../../../core/table-read/schema";
import { useFieldUpdates } from "./use-field-updates";

test("only actual accepted changes flash, unchanged polls do not extend the timer, and scope/session changes reset it", async () => {
  const dom = installDom(undefined, { globals: { IS_REACT_ACT_ENVIRONMENT: true } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  jest.useFakeTimers();
  function Probe({ session, scope }: { session: TableReadSession; scope: object }) { return <output>{useFieldUpdates(session, scope).join(",")}</output>; }
  let scope = {};
  let session = newInterview({ tempo: "deep-dive", idea: "A merciful debt collector", connection: { id: "saved", model: "model" } }, "session", "card");
  const render = async () => { await act(async () => root.render(<Probe session={session} scope={scope} />)); };
  try {
    await render(); expect(host.textContent).toBe("");
    session = { ...session }; await render(); expect(host.textContent).toBe("");
    session = { ...session, body: setCharacterField(session.body, "name", "Vesper") }; await render(); expect(host.textContent).toBe("name");
    await act(async () => jest.advanceTimersByTime(1000));
    session = { ...session }; await render();
    await act(async () => jest.advanceTimersByTime(1201)); expect(host.textContent).toBe("");
    session = { ...session, body: setCharacterField(session.body, "description", "She forgives debts in secret.") }; await render(); expect(host.textContent).toBe("description");
    scope = {}; session = { ...session, body: setCharacterField(session.body, "description", "An older restored draft") }; await render(); expect(host.textContent).toBe("");
    session = { ...session, body: setCharacterField(session.body, "name", "New name") }; await render(); expect(host.textContent).toBe("name");
    session = { ...session, id: "another-session" }; await render(); expect(host.textContent).toBe("");
  } finally { await act(async () => root.unmount()); jest.useRealTimers(); await dom.teardown(); }
});
