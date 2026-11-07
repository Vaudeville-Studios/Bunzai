/**
 * protect(): the inline form of the protected layer, for a control that spends money, reaches the network, runs a program or
 * destroys data (the closed list below, drawn with `protect(id)` on an element (on a wrapper `div` for a group), mirrored and docs/reference/extending/make-a-theme.md). It is a
 * `.host-protected` wrapper: mod selectors are scoped off it, the host palette and type pin apply, and the watchdog guards it.
 * A modal prompt uses ProtectedDialog instead; this is for a control that must stay in its row. The list is the only place the
 * set is named, so a new protected control is one more line here, and protected-set.test.ts checks that each is drawn in the layer.
 */
/** The controls inside the protected layer beyond the gates: id to the words the documentation uses. */
export const PROTECTED_CONTROLS = {
  "inspector-actions": "Prompt Inspector Send and Stop",
  "provider-keys": "Provider keys and models (Settings > Providers)",
  "mcp-connections": "MCP connections (Settings > Connections)",
  "spotify-link": "Spotify sign-in and Client ID",
  "narrator-tools": "Narrator Tool Access and Max tool rounds",
  "compendium-access": "Compendium per-book access grants",
  "regex-switches": "Scene regex set switches and deletes",
  "take-delete": "Delete and restore of takes",
  "entry-delete": "Delete and restore of lorebook entries",
  "participant-delete": "Remove and restore of participants",
  "tracker-delete": "Delete and remove of tracker items",
  "director-model": "Story Director model and connection",
  "director-reset": "Story Director Reset DM",
  "dramaturg-model": "Dramaturg model and connection",
} as const;

export type ProtectedControlId = keyof typeof PROTECTED_CONTROLS;

/** The two props that put any one element into the protected layer, for a control that must keep its place in a styled list. */
export const protect = (id: ProtectedControlId, className?: string): { className: string; "data-protected": ProtectedControlId } => ({
  className: ["host-protected", className].filter(Boolean).join(" "),
  "data-protected": id,
});
