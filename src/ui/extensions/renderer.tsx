/** Purpose: render guest-provided contribution data as bounded, accessible host controls; guests never provide markup or styles. */
import { useState, type JSX, type ReactNode } from "react";
import type { InteractiveNode } from "../../extensions/contracts/interactive";
import { decodeInteractiveDescriptor } from "../../extensions/contracts/interactive";
import { Button, Toggle } from "../components/button";
import { Input, Select } from "../components/rc-controls";
import styles from "./renderer.module.css";

export interface ExtensionRendererProps {
  packageId: string;
  packageName: string;
  descriptor: unknown;
  declaredCommands: readonly string[];
  assets?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onCommand(command: string, input: { id: string; value?: string | boolean }): void;
}

/** Renders only the shared bounded descriptor language, with package commands checked at the host boundary. */
export function ExtensionRenderer({ packageId, packageName, descriptor, declaredCommands, assets = {}, disabled = false, onCommand }: ExtensionRendererProps): JSX.Element {
  const tree = decodeInteractiveDescriptor(descriptor);
  const commands = new Set(declaredCommands);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const fire = (command: string, id: string, value?: string | boolean): void => {
    if (!commands.has(command)) return;
    onCommand(command, { id, ...(value === undefined ? {} : { value }) });
  };
  const renderNode = (node: InteractiveNode, key: string): ReactNode => {
    switch (node.type) {
      case "text": return <p key={key} className={styles.text}>{node.text}</p>;
      case "stack": return <div key={key} className={styles.stack}>{node.children.map(/* bounded-ok: decoder caps total tree at 200 nodes and depth 16 */ (child, index) => renderNode(child, `${key}.${index}`))}</div>;
      case "row": return <div key={key} className={styles.row}>{node.children.map(/* bounded-ok: decoder caps total tree at 200 nodes and depth 16 */ (child, index) => renderNode(child, `${key}.${index}`))}</div>;
      case "field": return <label key={key} className={styles.control}>{node.label}<Input disabled={disabled} aria-label={`${packageName}: ${node.label}`} maxLength={2_000} placeholder={node.placeholder} value={String(values[node.id] ?? node.value ?? "")} onChange={(event) => setValues((current) => ({ ...current, [node.id]: event.currentTarget.value }))} onBlur={(event) => fire(node.command, node.id, event.currentTarget.value)} /></label>;
      case "select": return <label key={key} className={styles.control}>{node.label}<Select disabled={disabled} aria-label={`${packageName}: ${node.label}`} value={String(values[node.id] ?? node.value)} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, [node.id]: value })); fire(node.command, node.id, value); }}>{node.options.map(/* bounded-ok: descriptor schema caps select options at 32 */ (option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></label>;
      case "toggle": return <Toggle key={key} disabled={disabled} label={`${packageName}: ${node.label}`} on={Boolean(values[node.id] ?? node.value)} onChange={(value) => { setValues((current) => ({ ...current, [node.id]: value })); fire(node.command, node.id, value); }} />;
      case "button": return <Button key={key} size="sm" disabled={disabled || !commands.has(node.command)} onClick={() => fire(node.command, node.id)}>{node.label}</Button>;
      case "list": return <ul key={key} className={styles.list}>{node.items.map(/* bounded-ok: descriptor schema caps each list at 50 and total tree at 200 nodes */ (child, index) => <li key={`${key}.${index}`}>{renderNode(child, `${key}.${index}`)}</li>)}</ul>;
      case "image": { const src = assets[node.asset]; return src ? <img key={key} className={styles.image} src={src} alt={node.alt} loading="lazy" /> : null; }
    }
  };
  return <section className={styles.root} aria-label={`${packageName} extension`} data-extension-id={packageId}>{renderNode(tree.root, "root")}</section>;
}
