/** Appearance picker only; theme package installation, updates and permissions live in Extensions. */
import { useCallback, useEffect, useState, type JSX } from "react";
import type { AppContext } from "../../../app-contract";
import { DEFAULT_STUDIO_THEME, SETTING_KEYS } from "../../../../studio/settings-shape";
import type { InstalledExtensionSummary } from "../../../../extensions/runtime/service";
import { Button } from "../../../components/button";
import { ProtectedLine } from "../section-contract";
import styles from "./theme-manager.module.css";
import { toErrorMessage } from "../../../../error-message";

export function ThemeManager({ ctx }: { ctx: AppContext }): JSX.Element {
  const requested = ctx.prefs.get(SETTING_KEYS.theme);
  const selected = typeof requested === "string" ? requested : DEFAULT_STUDIO_THEME;
  const [items, setItems] = useState<readonly InstalledExtensionSummary[]>([]);
  const [active, setActive] = useState(() => ctx.appearance.get());
  const [note, setNote] = useState("");
  const preferenceFor = (item: InstalledExtensionSummary): string => item.hostTrusted && item.id.startsWith("bunzai.host.theme.") ? item.id.slice("bunzai.host.theme.".length) : item.id;
  const selectedItem = items.find((item) => preferenceFor(item) === selected);
  const activeMatches = active.themeId === selected || Boolean(selectedItem?.hostTrusted && active.themeId === selectedItem.id);
  const refresh = useCallback(async () => {
    try { setItems((await ctx.api.extensions.list()).filter((item) => item.theme !== null)); }
    catch (error) { setNote(toErrorMessage(error, "Could not load installed themes.")); }
  }, [ctx]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => ctx.appearance.onChange(() => setActive(ctx.appearance.get())), [ctx]);
  const choose = (item: InstalledExtensionSummary): void => {
    ctx.prefs.set(SETTING_KEYS.theme, preferenceFor(item));
    setNote("Theme selection saved. Its approved appearance applies when the host confirms it is enabled.");
  };
  return <section className={`${styles.manager} host-protected`} aria-labelledby="theme-manager-heading">
    <ProtectedLine>Choose an installed appearance. Install packages and review their permissions in Extensions.</ProtectedLine>
    <h3 id="theme-manager-heading">Appearance packages</h3>
    <p role="status">{activeMatches ? `Effective: ${active.name ?? active.themeId}.` : `Core appearance is active; requested theme is ${selected}.`}{active.fallbackReason ? ` ${active.fallbackReason.replaceAll("-", " ")}.` : ""}</p>
    <ul className={styles.catalog} aria-label="Installed appearance packages">
      {items.map(/* bounded-ok: extension store has a bounded record count */ (item) => {
        const palette = item.theme!.appearance.palette;
        const colors = [palette.surface.base, palette.surface.panel, palette.text.text, palette.roles.brand.fill, palette.roles.action.fill, palette.roles.select.fill, palette.roles.ok.fill];
        const requestedId = preferenceFor(item);
        const isSelected = requestedId === selected;
        return <li key={item.id} data-selected={isSelected ? "" : undefined}>
          <div className={styles.strip} aria-hidden="true">{colors.map(/* bounded-ok: fixed 7-color validated palette preview */ (color, index) => <i key={index} style={{ backgroundColor: color }} />)}</div>
          <div className={styles.name}><strong>{item.name}</strong><span>v{item.version} · {item.enabled ? "enabled" : "disabled"}</span><code>{item.themeScopes.length ? `Approved: ${item.themeScopes.map((scope) => scope.replaceAll(".", " ")).join(" · ")}` : "No appearance access approved"}</code></div>
          <Button size="sm" variant="quiet" aria-pressed={isSelected} disabled={isSelected || !item.enabled} onClick={() => choose(item)}>{isSelected ? "Requested" : "Request"}</Button>
        </li>;
      })}
    </ul>
    {note && <p role="status">{note}</p>}
  </section>;
}
