/**
 * The chat layout the person picked once for every scene (RoleCall's chat appearance, lib/scene/chat-appearance.ts): Full Chat
 * (the wings around the chat), Familiar, Basic, Desktop 98, Messenger or Immersive. Studio-wide, saved in the app preferences; unset until the
 * chooser saves it, so a scene opened before then shows the chooser instead of the chat. A saved value Bunzai cannot read is
 * treated as unset (the chooser asks again) rather than guessed.
 */

export const CHAT_LAYOUTS = ["stage", "familiar", "basic", "desktop98", "messenger", "immersive"] as const;
export type ChatLayout = (typeof CHAT_LAYOUTS)[number];
export const CHAT_LAYOUT_KEY = "scenes.chatLayout";

export const isChatLayout = (value: unknown): value is ChatLayout =>
  typeof value === "string" && (CHAT_LAYOUTS as readonly string[]).includes(value);

export function chatLayoutOf(prefs: { get(key: string): unknown }): ChatLayout | null {
  const value = prefs.get(CHAT_LAYOUT_KEY);
  return isChatLayout(value) ? value : null;
}
