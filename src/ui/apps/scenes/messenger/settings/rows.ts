/**
 * The simple rows of the Messenger settings pages, as data: one entry per value that is already stored somewhere (an app preference),
 * with the existing getter and writer named in its read and write. Nothing here stores anything: a row reads and writes `ctx.prefs` under the key the Full Chat Stage wing uses. Ranges, steps and defaults come from the constants
 * those owners export. The scene fields the wireframe drew as rows (tool rounds, show prefill) already have rows inside the Control Booth and Generation bodies the scene scope places, so they are not drawn twice.
 */
import type { AppContext } from "../../../../app-contract";
import { LAYOUT_OPTIONS } from "../../layout-options";
import { CHAT_LAYOUT_KEY, chatLayoutOf } from "../../chat-layout";
import { AUTO_OPEN_KEY, CAP_LONG_KEY, autoOpenReasoning, capLongReasoning } from "../../scene-reasoning-core";
import { SHOW_TIMESTAMPS_KEY, showTimestamps } from "../../scene-meta-core";
import { AUTO_SCROLLS, LIMITS, LOOK_FONTS, LOOK_KEYS, readLook } from "../../stage-look-core";
import { VOLUME_KEY, volumeOf } from "../../stage-music-core";
import type { ChoiceOption } from "../frames/settings-rows";

/** What a row reads and writes: the app preferences, which are not reactive, so a write repaints the page. */
export interface RowEnv { ctx: AppContext; repaint(): void }

interface Base { id: string; label: string; description?: string }
export interface ToggleDef extends Base { control: "toggle"; read(env: RowEnv): boolean; write(env: RowEnv, value: boolean): void }
export interface NumberDef extends Base { control: "slider"; min: number; max: number; step: number; unit?: string; read(env: RowEnv): number; write(env: RowEnv, value: number): void }
export interface ChoiceDef extends Base { control: "select" | "radios"; options: readonly ChoiceOption[]; read(env: RowEnv): string; write(env: RowEnv, value: string): void }
export type RowDef = ToggleDef | NumberDef | ChoiceDef;

type BoolLook = "avatars" | "fadeIn" | "compact" | "chime" | "typing";
const look = (env: RowEnv): ReturnType<typeof readLook> => readLook(env.ctx.prefs);
const setPref = (env: RowEnv, key: string, value: unknown): void => { env.ctx.prefs.set(key, value); env.repaint(); };
const lookToggle = (key: BoolLook, label: string, description: string): ToggleDef =>
  ({ id: key, label, description, control: "toggle", read: (env) => look(env)[key], write: (env, v) => setPref(env, LOOK_KEYS[key], v) });
const tenth = (n: number): number => Math.round(n * 10) / 10;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const SCROLL_COPY: Record<(typeof AUTO_SCROLLS)[number], string> = { always: "Follow every new reply.", smart: "Follow only when you are near the bottom.", never: "Stay where you are." };

export const USER_ROWS = {
  layout: { id: "layout", label: "Chat layout", description: "Which chat layout scenes use.", control: "radios",
    options: LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.title, description: o.description })),
    read: (env) => chatLayoutOf(env.ctx.prefs) ?? "stage", write: (env, v) => setPref(env, CHAT_LAYOUT_KEY, v) } satisfies ChoiceDef,
  avatars: lookToggle("avatars", "Show avatars", "A small portrait beside the first message of each run."),
  timestamps: { id: "timestamps", label: "Show timestamps", description: "The time on the first message of a run.", control: "toggle",
    read: (env) => showTimestamps(env.ctx.prefs.get(SHOW_TIMESTAMPS_KEY)), write: (env, v) => setPref(env, SHOW_TIMESTAMPS_KEY, v) } satisfies ToggleDef,
  opacity: { id: "opacity", label: "Message bubble opacity", description: "Lower it to let the backdrop show through. 100% is the default.", control: "slider",
    min: Math.round(LIMITS.opacity[0] * 100), max: Math.round(LIMITS.opacity[1] * 100), step: Math.round(LIMITS.opacity[2] * 100), unit: "%",
    read: (env) => Math.round(look(env).opacity * 100), write: (env, v) => setPref(env, LOOK_KEYS.opacity, v / 100) } satisfies NumberDef,
  gap: { id: "gap", label: "Message spacing", description: "Extra space between messages in the list.", control: "slider", min: LIMITS.gap[0], max: LIMITS.gap[1], step: LIMITS.gap[2], unit: " px",
    read: (env) => look(env).gap, write: (env, v) => setPref(env, LOOK_KEYS.gap, v) } satisfies NumberDef,
  font: { id: "font", label: "Message font", description: "The typeface of message text.", control: "select", options: LOOK_FONTS.map((f) => ({ value: f.id, label: f.label })),
    read: (env) => look(env).font, write: (env, v) => setPref(env, LOOK_KEYS.font, v) } satisfies ChoiceDef,
  size: { id: "size", label: "Message text size", control: "slider", min: LIMITS.size[0], max: LIMITS.size[1], step: LIMITS.size[2], unit: " px",
    read: (env) => look(env).size, write: (env, v) => setPref(env, LOOK_KEYS.size, v) } satisfies NumberDef,
  lineHeight: { id: "lineHeight", label: "Line spacing", description: "Line height as a multiple of the text size.", control: "slider", min: LIMITS.lineHeight[0], max: LIMITS.lineHeight[1], step: LIMITS.lineHeight[2], unit: "x",
    read: (env) => tenth(look(env).lineHeight), write: (env, v) => setPref(env, LOOK_KEYS.lineHeight, tenth(v)) } satisfies NumberDef,
  autoScroll: { id: "autoScroll", label: "Auto-scroll", control: "radios", options: AUTO_SCROLLS.map((v) => ({ value: v, label: cap(v), description: SCROLL_COPY[v] })),
    read: (env) => look(env).autoScroll, write: (env, v) => setPref(env, LOOK_KEYS.autoScroll, v) } satisfies ChoiceDef,
  capReasoning: { id: "capReasoning", label: "Cap long reasoning", description: "Keep a long block to 300px and scroll inside it.", control: "toggle",
    read: (env) => capLongReasoning(env.ctx.prefs.get(CAP_LONG_KEY)), write: (env, v) => setPref(env, CAP_LONG_KEY, v) } satisfies ToggleDef,
  autoOpenReasoning: { id: "autoOpenReasoning", label: "Auto-open reasoning", description: "Open a reply's thinking block as it arrives.", control: "toggle",
    read: (env) => autoOpenReasoning(env.ctx.prefs.get(AUTO_OPEN_KEY)), write: (env, v) => setPref(env, AUTO_OPEN_KEY, v) } satisfies ToggleDef,
  fadeIn: lookToggle("fadeIn", "Streaming fade-in", "Fade new words in as they arrive."),
  compact: lookToggle("compact", "Compact mode", "Tighter rows in the chat."),
  chime: lookToggle("chime", "Response chime", "A short sound when a reply finishes and the window is not focused."),
  typing: lookToggle("typing", "Typing indicator", "Three dots while a character is writing."),
  volume: { id: "volume", label: "Volume", description: "Mood music volume.", control: "slider", min: 0, max: 100, step: 1, unit: "%",
    read: (env) => Math.round(volumeOf(env.ctx.prefs.get(VOLUME_KEY)) * 100), write: (env, v) => setPref(env, VOLUME_KEY, v / 100) } satisfies NumberDef,
} as const;

export const ALL_ROWS: readonly RowDef[] = Object.values(USER_ROWS);
