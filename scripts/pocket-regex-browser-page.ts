/** Purpose: expose the production regex adapter to the isolated static Pages browser probe. */
import { runRegexSandboxed } from "../src/ui/apps/workbench/regex/run-in-worker";

declare global {
  interface Window { runPocketRegexProbe(): ReturnType<typeof runRegexSandboxed> }
}

window.runPocketRegexProbe = () => runRegexSandboxed("opaque-frame-regex", [], { phase: "output" });
