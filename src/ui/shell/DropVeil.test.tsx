/** Local upload targets keep file drops local while unmarked window drops still enter Library. */
import { afterAll, expect, test } from "bun:test";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { consumeImportRequests } from "../_shared/import-signal";
import { installDom, teardownAllDoms } from "../_shared/test-dom";
import { DropVeil } from "./DropVeil";

afterAll(teardownAllDoms);

test("a marked local drop reaches its handler once; an outside drop still requests Library import", async () => {
  const { dom } = installDom('<!doctype html><div id="root"></div>', { extraGlobals: ["Event"], globals: { IS_REACT_ACT_ENVIRONMENT: false } });
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  const local: File[][] = [];
  const imported: (File[] | null)[] = [];
  const stopImport = consumeImportRequests((files) => imported.push(files));
  const file = new dom.window.File(["image"], "crest.png", { type: "image/png" });
  const drop = (target: Element): void => {
    const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [file], items: [] } });
    target.dispatchEvent(event);
  };
  try {
    flushSync(() => root.render(<><DropVeil />
      <div data-local-file-drop onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); local.push([...event.dataTransfer.files]); }}>Backdrop target</div>
      <div>Window import target</div>
    </>));
    drop(host.querySelector("[data-local-file-drop]")!);
    expect(local).toEqual([[file]]);
    expect(imported).toEqual([]);
    drop(host.querySelector("div:last-child")!);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(imported).toEqual([[file]]);
  } finally { stopImport(); flushSync(() => root.unmount()); }
});
