/** Chat layout labels and chooser copy, ported from VAUDEVILLE ChatAppearanceChooser. */
import type { ChatLayout } from "./chat-layout";
export const LAYOUT_OPTIONS: readonly { value: ChatLayout; title: string; image: string; lead: string; description: string }[] = [
  { value: "stage", title: "Full Chat", image: "full-chat", lead: "Your complete writing workspace.", description: "Keep the conversation, character details and trackers together, with your tools close at hand." },
  { value: "familiar", title: "Familiar", image: "familiar", lead: "Room for the conversation.", description: "A wide chat beside a compact sidebar. Open your characters and tools as you need them." },
  { value: "basic", title: "Basic", image: "basic", lead: "Just you and your character.", description: "A pared-back conversation, with settings tucked away until you want them." },
  { value: "desktop98", title: "Desktop 98", image: "desktop98", lead: "Your own little desktop.", description: "An instant messenger, desktop programs and a taskbar, all connected to your scene." },
  { value: "messenger", title: "Messenger", image: "messenger", lead: "A familiar place to catch up.", description: "Recent characters, your persona profile and a conversation with one settings workspace." },
  { value: "immersive", title: "Immersive", image: "immersive", lead: "Let the scene take the stage.", description: "A cinematic conversation with a large portrait and quiet controls." },
];
