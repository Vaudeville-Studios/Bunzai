/** Purpose: render only host-defined scalar package settings and save with the store's expected revision. */
import { useState, type JSX } from "react";
import { settingsDefinitionSchema, type SettingsDefinition, type SettingsProperty } from "../../extensions/contracts/package";
import type { JsonValue } from "../../extensions/contracts/value";
import type { ExtensionManagerApi } from "../../extensions/runtime/service";
import { Button } from "../components/button";
import { Checkbox, Input, Select } from "../components/rc-controls";
import { isRecord } from "../../core/guards";
import { toErrorMessage } from "../../error-message";

type SettingsSchema = SettingsDefinition;
type SettingProperty = SettingsProperty;
const scalarProperty = (schema: SettingsSchema): SettingProperty | null => schema.type === "object" ? null : ({
  type: schema.type as SettingProperty["type"], title: schema.title, description: schema.description,
  enum: schema.enum, minimum: schema.minimum, maximum: schema.maximum, minLength: schema.minLength, maxLength: schema.maxLength,
});

type ReadSettings = Awaited<ReturnType<ExtensionManagerApi["readSettings"]>>;
type WriteSettings = Awaited<ReturnType<ExtensionManagerApi["writeSettings"]>>;

export function ExtensionSettingsEditor({ id, packageName, enabled, recoveryRequired, canWrite, api }: {
  id: string; packageName: string; enabled: boolean; recoveryRequired: boolean; canWrite: boolean; api: ExtensionManagerApi;
}): JSX.Element {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ReadSettings | null>(null), [value, setValue] = useState<JsonValue | null>(null), [message, setMessage] = useState("");
  const load = async (discard = false): Promise<void> => {
    if (saving || loading) return;
    if (discard) setMessage("");
    setLoading(true);
    try { const next = await api.readSettings(id); setSettings(next); setValue(next.value); setMessage(""); setOpen(true); }
    catch (error) { setMessage(toErrorMessage(error, "Could not load extension settings.")); }
    finally { setLoading(false); }
  };
  const save = async (): Promise<void> => {
    if (!settings || value === null || !canWrite || saving) return;
    setSaving(true); setMessage("");
    try {
      const result: WriteSettings = await api.writeSettings(id, value, settings.revision);
      if (result.status === "stale") { setMessage("Settings changed elsewhere. Reload before saving."); return; }
      setSettings({ ...settings, revision: result.revision }); setMessage("Settings saved.");
    } catch (error) { setMessage(toErrorMessage(error, "Could not save settings.")); }
    finally { setSaving(false); }
  };
  const parsed = settings?.schema === null || settings?.schema === undefined ? null : settingsDefinitionSchema.safeParse(settings.schema);
  const schema = parsed?.success ? parsed.data : null;
  const rootProperty = schema ? scalarProperty(schema) : null;
  const setField = (key: string, next: JsonValue): void => {
    if (schema?.type === "object") {
      const current = isRecord(value) ? value as Record<string, JsonValue> : Object.create(null) as Record<string, JsonValue>;
      setValue(Object.assign(Object.create(null), current, { [key]: next }) as JsonValue);
    } else setValue(next);
    setMessage("");
  };
  const field = (key: string, spec: SettingProperty, current: JsonValue | undefined): JSX.Element => {
    const label = spec.title ?? key;
    if (spec.enum) return <label key={key}>{label}<Select value={current === undefined ? "" : JSON.stringify(current)} disabled={!canWrite || saving} onChange={(event) => { const selected = spec.enum?.find((item) => JSON.stringify(item) === event.currentTarget.value); if (selected !== undefined) setField(key, selected); }}><option value="">Choose…</option>{spec.enum.map(/* bounded-ok: settings schema enums are capped at 64 values */ (item) => <option key={JSON.stringify(item)} value={JSON.stringify(item)}>{String(item)}</option>)}</Select>{spec.description && <small>{spec.description}</small>}</label>;
    if (spec.type === "boolean") return <label key={key}><Checkbox checked={current === true} disabled={!canWrite || saving} onChange={(event) => setField(key, event.currentTarget.checked)} />{label}{spec.description && <small>{spec.description}</small>}</label>;
    return <label key={key}>{label}<Input type={spec.type === "string" ? "text" : "number"} maxLength={spec.maxLength} min={spec.minimum} max={spec.maximum} value={current === undefined ? "" : String(current)} disabled={!canWrite || saving} onChange={(event) => {
      const raw = event.currentTarget.value;
      if (spec.type === "string") setField(key, raw);
      else if (raw === "") setField(key, "");
      else if (Number.isFinite(Number(raw))) setField(key, spec.type === "integer" ? Math.trunc(Number(raw)) : Number(raw));
    }} />{spec.description && <small>{spec.description}</small>}</label>;
  };
  const objectValue = isRecord(value) ? value as Record<string, JsonValue> : null;
  const currentScalar = value !== null && (typeof value === "string" || typeof value === "number" || typeof value === "boolean") ? value : undefined;
  return <section aria-label={`${packageName} settings`}>
    {!open ? <Button size="sm" disabled={loading} onClick={() => void load()}>{loading ? "Loading settings…" : "Edit settings"}</Button> : <>
      <h4>{packageName} settings</h4>
      {!schema && <p>{settings?.schema === null ? "This package has no settings schema." : "The package settings schema is invalid or unavailable."}</p>}
      {schema?.type === "object" && <div>{Object.entries(schema.properties ?? {}).map(([key, spec]) => field(key, spec, objectValue?.[key]))}</div>}
      {rootProperty && field("value", rootProperty, currentScalar)}
      {settings?.revision !== undefined && <p>Settings revision {settings.revision}{!canWrite && " · read only"}</p>}
      {recoveryRequired && <p>Access review is required before this package can write settings.</p>}
      {enabled && !canWrite && !recoveryRequired && <p>Review access and grant settings.update to save changes.</p>}
      <div><Button size="sm" variant="primary" disabled={!canWrite || saving || !schema || value === null} onClick={() => void save()}>{saving ? "Saving…" : "Save settings"}</Button><Button size="sm" disabled={loading || saving} onClick={() => void load(true)}>Reload and discard edits</Button><Button size="sm" variant="quiet" disabled={saving} onClick={() => setOpen(false)}>Close</Button></div>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
