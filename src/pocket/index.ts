/** Boot the static, tab-scoped Bunzai Studio before mounting the ordinary React shell. */
import { installPocketRuntime } from "./runtime";

const disposePocket = installPocketRuntime();
window.addEventListener("pagehide", disposePocket, { once: true });
await import("../ui/boot");
