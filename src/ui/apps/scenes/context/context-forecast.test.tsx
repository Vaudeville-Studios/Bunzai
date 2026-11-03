/** Next send on the scene page (rc-parity 08): what is typed in the composer is forecast while the wing's Next send tab shows, and only then. */
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { click, endsOnReply, installRigDom, mount, resetRig, rig, settle, type, unmount } from "../fake-scene-page-rig";
import { waitFor } from "../../../_shared/test-dom";

beforeAll(installRigDom);
beforeEach(resetRig);

const tab = (label: string): HTMLElement => [...rig.dom.window.document.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => b.textContent?.startsWith(label))!;

describe("ScenePage: Context > Next send", () => {
  test("the forecast follows the box after a pause, and nothing is asked while another tab shows", async () => {
    const flushSync = await mount(endsOnReply());
    const doc = rig.dom.window.document;
    click(flushSync, doc.querySelector('[data-wing="context"]')!);
    await settle(flushSync);
    type(flushSync, "Any storms?");
    await settle(flushSync, 450);
    expect(rig.forecasts).toEqual([]);
    click(flushSync, tab("Next send"));
    await waitFor(flushSync, () => doc.querySelector(".ns-msg.user pre")?.textContent === "Any storms?", "the forecast of the current draft");
    expect(rig.forecasts).toEqual(["Any storms?"]);
    expect(doc.querySelector(".ns-hd p")?.textContent).toBe("1 message | ~3 tokens");
    expect(doc.querySelector(".ns-msg.user pre")?.textContent).toBe("Any storms?");
    type(flushSync, "Any storms tonight?");
    await waitFor(flushSync, () => doc.querySelector(".ns-msg.user pre")?.textContent === "Any storms tonight?", "the updated forecast");
    expect(rig.forecasts.at(-1)).toBe("Any storms tonight?");
    unmount(flushSync);
  });
});
