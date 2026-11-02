/** VAUDEVILLE Desktop 98 window geometry and transitions, kept independent of scene state. */
export interface Desktop98Bounds { x: number; y: number; width: number; height: number }
export interface Desktop98Viewport { width: number; height: number }
export interface Desktop98Window {
  id: string;
  bounds: Desktop98Bounds;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  z: number;
}
export interface Desktop98WindowState { windows: Desktop98Window[]; activeId: string | null }
export type Desktop98WindowAction =
  | { type: "open"; id: string; viewport: Desktop98Viewport }
  | { type: "focus" | "minimize" | "close" | "maximize"; id: string }
  | { type: "bounds"; id: string; bounds: Desktop98Bounds; viewport: Desktop98Viewport }
  | { type: "viewport"; viewport: Desktop98Viewport };

export const DESKTOP98_TASKBAR_HEIGHT = 38;
export type Desktop98ResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export function resizeDesktop98Bounds(initial: Desktop98Bounds, edge: Desktop98ResizeEdge, dx: number, dy: number, viewport: Desktop98Viewport): Desktop98Bounds {
  const start = clampDesktop98Bounds(initial, viewport);
  const minWidth = Math.min(280, viewport.width);
  const bottomLimit = Math.max(120, viewport.height - DESKTOP98_TASKBAR_HEIGHT);
  const minHeight = Math.min(180, bottomLimit);
  let { x: left, y: top } = start;
  let right = left + start.width;
  let bottom = top + start.height;
  if (edge.includes("w")) left = Math.max(0, Math.min(left + dx, right - minWidth));
  if (edge.includes("e")) right = Math.min(viewport.width, Math.max(right + dx, left + minWidth));
  if (edge.includes("n")) top = Math.max(0, Math.min(top + dy, bottom - minHeight));
  if (edge.includes("s")) bottom = Math.min(bottomLimit, Math.max(bottom + dy, top + minHeight));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function clampDesktop98Bounds(bounds: Desktop98Bounds, viewport: Desktop98Viewport): Desktop98Bounds {
  const availableHeight = Math.max(120, viewport.height - DESKTOP98_TASKBAR_HEIGHT);
  const width = Math.min(Math.max(280, bounds.width), viewport.width);
  const height = Math.min(Math.max(180, bounds.height), availableHeight);
  return { width, height, x: Math.max(0, Math.min(bounds.x, viewport.width - width)), y: Math.max(0, Math.min(bounds.y, availableHeight - height)) };
}

export function desktop98DefaultBounds(viewport: Desktop98Viewport, index = 0, chat = false): Desktop98Bounds {
  const width = chat ? Math.min(920, viewport.width - 128) : 560;
  const height = Math.min(chat ? 700 : 580, viewport.height - 76);
  return clampDesktop98Bounds({ width, height, x: chat ? Math.max(108, viewport.width - width - 28) : 140 + (index % 5) * 28, y: chat ? 22 : 48 + (index % 5) * 25 }, viewport);
}

export function desktop98VisibleBounds(window: Desktop98Window, viewport: Desktop98Viewport): Desktop98Bounds {
  if (window.maximized || viewport.width <= 720) return { x: 0, y: 0, width: viewport.width, height: Math.max(120, viewport.height - DESKTOP98_TASKBAR_HEIGHT) };
  return clampDesktop98Bounds(window.bounds, viewport);
}

export function createDesktop98WindowState(viewport: Desktop98Viewport): Desktop98WindowState {
  return { windows: [{ id: "chat", bounds: desktop98DefaultBounds(viewport, 0, true), open: true, minimized: false, maximized: false, z: 1 }], activeId: "chat" };
}

export function desktop98WindowReducer(state: Desktop98WindowState, action: Desktop98WindowAction): Desktop98WindowState {
  const nextZ = Math.max(0, ...state.windows.map(window => window.z)) + 1;
  if (action.type === "viewport") return { ...state, windows: state.windows.map(window => ({ ...window, bounds: clampDesktop98Bounds(window.bounds, action.viewport) })) };
  const target = state.windows.find(window => window.id === action.id);
  if (action.type === "open") {
    if (!target) return { activeId: action.id, windows: [...state.windows, { id: action.id, bounds: desktop98DefaultBounds(action.viewport, state.windows.length - 1), open: true, minimized: false, maximized: false, z: nextZ }] };
    return { activeId: action.id, windows: state.windows.map(window => window.id === action.id ? { ...window, open: true, minimized: false, z: nextZ } : window) };
  }
  if (!target) return state;
  if (action.type === "bounds") return { ...state, windows: state.windows.map(window => window.id === action.id ? { ...window, bounds: clampDesktop98Bounds(action.bounds, action.viewport) } : window) };
  if (action.type === "focus") {
    if (!target.open || target.minimized || state.activeId === action.id) return state;
    return { activeId: action.id, windows: state.windows.map(window => window.id === action.id ? { ...window, z: nextZ } : window) };
  }
  if (action.type === "maximize") return { activeId: action.id, windows: state.windows.map(window => window.id === action.id ? { ...window, maximized: !window.maximized, minimized: false, z: nextZ } : window) };
  const windows = state.windows.map(window => window.id === action.id ? { ...window, ...(action.type === "close" ? { open: false } : { minimized: true }) } : window);
  const nextActive = windows.filter(window => window.open && !window.minimized).sort((a, b) => b.z - a.z)[0]?.id ?? null;
  return { windows, activeId: state.activeId === action.id ? nextActive : state.activeId };
}
