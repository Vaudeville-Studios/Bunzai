/** Chat layout labels and chooser copy, ported from VAUDEVILLE ChatAppearanceChooser; Letters, Notebook and Storybook are Bunzai's own. */
import type { ChatLayout } from "./chat-layout";
export const LAYOUT_OPTIONS: readonly { value: ChatLayout; title: string; image: string; lead: string; description: string }[] = [
  { value: "stage", title: "Full Chat", image: "full-chat", lead: "Your complete writing workspace.", description: "Keep the conversation, character details and trackers together, with your tools close at hand." },
  { value: "familiar", title: "Familiar", image: "familiar", lead: "Room for the conversation.", description: "A wide chat beside a compact sidebar. Open your characters and tools as you need them." },
  { value: "basic", title: "Basic", image: "basic", lead: "Just you and your character.", description: "A pared-back conversation, with settings tucked away until you want them." },
  { value: "desktop98", title: "Desktop 98", image: "desktop98", lead: "Your own little desktop.", description: "An instant messenger, desktop programs and a taskbar, all connected to your scene." },
  { value: "messenger", title: "Messenger", image: "messenger", lead: "A familiar place to catch up.", description: "Recent characters, your persona profile and a conversation with one settings workspace." },
  { value: "immersive", title: "Immersive", image: "immersive", lead: "Let the scene take the stage.", description: "A cinematic conversation with a large portrait and quiet controls." },
  { value: "letters", title: "Letters", image: "letters", lead: "A correspondence, one page at a time.", description: "Every message arrives as a letter in a calm column, signed by its writer, with a portrait stamp in the corner." },
  { value: "notebook", title: "Notebook", image: "notebook", lead: "Your story in a ruled journal.", description: "Lined pages with a margin rule, and your scene tools as colored tabs along the edge of the page." },
  { value: "storybook", title: "Storybook", image: "storybook", lead: "Read it like an open book.", description: "The portrait and a contents page of tools on the left, the conversation on the right." },
];
