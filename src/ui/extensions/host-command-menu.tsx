/** Purpose: invoke registered extension commands with a separate bounded host-selected resource context. */
import { useEffect, useRef, useState, type JSX } from "react";
import type { ExtensionActivationResult, ExtensionManagerApi, InstalledExtensionSummary } from "../../extensions/runtime/service-api";
import type { JsonValue } from "../../extensions/contracts/value";
import type { ResourceRef } from "../../extensions/contracts/operation";
import { extensionInvocationContextSchema, MAX_EXTENSION_INVOCATION_RESOURCES } from "../../extensions/contracts/invocation-context";
import { toErrorMessage } from "../../error-message";
import { Button } from "../components/button";
import { VirtualRows } from "../_shared/virtual-list";
import styles from "./host-command-menu.module.css";

export interface HostCommandMenuProps {
  api: Pick<ExtensionManagerApi, "list">;
  resources: readonly ResourceRef[];
  onActivate(packageId: string, commandId: string, input: JsonValue, resources: readonly ResourceRef[]): Promise<ExtensionActivationResult>;
}

export function HostCommandMenu({ api, resources, onActivate }: HostCommandMenuProps): JSX.Element | null {
  const commandScroll = useRef<HTMLDivElement>(null);
  const [extensions, setExtensions] = useState<readonly InstalledExtensionSummary[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { let active = true; void api.list().then((items) => { if (active) setExtensions(items); }).catch(() => { if (active) setNotice("Installed extensions could not be loaded."); }); return () => { active = false; }; }, [api]);
  const parsed = extensionInvocationContextSchema.safeParse({ resources });
  const keys = new Set(resources.map(({ kind, id }) => `${kind}:${id}`));
  const scopeError = resources.length > MAX_EXTENSION_INVOCATION_RESOURCES
    ? `Choose at most ${MAX_EXTENSION_INVOCATION_RESOURCES} pieces before running an extension command.`
    : !parsed.success || keys.size !== resources.length ? "The current selection cannot be used as extension context." : "";
  const context = parsed.success ? parsed.data.resources : [];
  const commands = extensions.flatMap((item) => item.enabled && !item.recoveryRequired
    ? item.contributions.flatMap((part) => part.type === "command" && item.registeredCommands.includes(part.id)
      ? [{ packageId: item.id, packageName: item.name, commandId: part.id, label: part.label }]
      : [])
    : []);
  if (!commands.length && !notice) return null;

  const run = async (command: typeof commands[number]): Promise<void> => {
    if (scopeError || running) { setNotice(scopeError || "An extension command is already running."); return; }
    const key = `${command.packageId}:${command.commandId}`;
    setRunning(key); setNotice("");
    try { await onActivate(command.packageId, command.commandId, null, context); setNotice(`${command.packageName}: ${command.label} finished.`); }
    catch (error) { setNotice(toErrorMessage(error)); }
    finally { setRunning(null); }
  };

  return <section aria-label="Extension commands">
    <h2>Extension commands</h2>
    {resources.length > 0 && <p>{scopeError || `${resources.length} focused piece${resources.length === 1 ? "" : "s"} will be offered as context. Access grants still control what each command can read or change.`}</p>}
    {!resources.length && <p>No focused pieces are attached to this command. Commands that need piece context will be denied by their grants.</p>}
    <div ref={commandScroll} className={styles.commandScroll} role="group" aria-label="Registered extension commands">
      <VirtualRows items={commands} keyOf={(command) => `${command.packageId}:${command.commandId}`} pinKey={running} render={(command) => <Button size="sm" disabled={!!scopeError || running !== null} onClick={() => void run(command)}>
        {running === `${command.packageId}:${command.commandId}` ? "Running..." : `${command.packageName}: ${command.label}`}
      </Button>} estimate={40} scroll={commandScroll} className={styles.commandRows} />
    </div>
    {(scopeError || notice) && <p role="status" aria-live="polite">{scopeError || notice}</p>}
  </section>;
}
