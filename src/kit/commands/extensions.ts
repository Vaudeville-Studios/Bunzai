/** Run only manifest-declared extension commands through Kit's fenced Terminal service. */
import type { KitCommand } from "./command";
import { runExtensionCommand } from "../extensions/commands";
import type { SessionCommandContext } from "../sessions/session-actions";

const command: KitCommand = {
  name: "/extension",
  aliases: ["/extensions"],
  summary: "list or run an installed extension command",
  group: "moving",
  run: (ctx) => runExtensionCommand(ctx as SessionCommandContext),
};

export default command;
