import { bunzai } from "bunzai-extension-sdk";

bunzai.extension.define({
  commands: {
    "read-file": async () => {
      const selected = await bunzai.operations.filesPick({ mode: "read" });
      if (!selected) return { status: "cancelled" };
      const file = await bunzai.operations.filesRead({ handleId: selected.id, maxBytes: 65_536 });
      if (!file) return { status: "unavailable" };
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return {
        type: "bunzai.ui",
        descriptor: {
          version: 1,
          root: {
            type: "stack",
            children: [
              { type: "text", text: "Read " + selected.name + " (" + file.bytes + " bytes)." },
              { type: "text", text: "SHA-256 " + file.digest },
              { type: "text", text: text.slice(0, 2_000) || "(empty file)" }
            ]
          }
        }
      };
    }
  }
});
