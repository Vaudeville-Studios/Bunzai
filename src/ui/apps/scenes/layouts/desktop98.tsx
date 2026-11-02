/** VAUDEVILLE Desktop 98: retained scene programs, movable windows and a taskbar around the shared chat. */
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type JSX, type PointerEvent } from "react";
import { Button, IconButton } from "../../../components/button";
import { VirtualRows } from "../../../_shared/virtual-list";
import { Ic } from "../../../_shared/ic";
import { isEscapeClose } from "../../../_shared/use-escape-key";
import { useMessengerNav } from "../messenger/use-messenger-nav";
import { ProgramPortals, ProgramSlot, useProgramHolders } from "../messenger/shell/program-holders";
import { createDesktop98WindowState, desktop98VisibleBounds, desktop98WindowReducer, resizeDesktop98Bounds, type Desktop98Viewport, type Desktop98Window } from "./desktop98-windows";
import type { LayoutProps } from "./layout-props";

const INITIAL = { width: 1280, height: 800 };
export function Desktop98(p: LayoutProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Desktop98Viewport>(INITIAL);
  const [state, dispatch] = useReducer(desktop98WindowReducer, INITIAL, createDesktop98WindowState);
  const [start, setStart] = useState(false);
  const nav = useMessengerNav(p.programs, p.request);
  const holderOf = useProgramHolders();
  const open = (id: string): void => { if (id !== "chat") nav.open(id); else nav.close(); dispatch({ type: "open", id, viewport }); setStart(false); };
  const chatWindow = state.windows.find((w) => w.id === "chat")!;
  const chatBounds = desktop98VisibleBounds(chatWindow, viewport);
  const hidden = (w: Desktop98Window): boolean => !w.open || w.minimized || (viewport.width <= 720 && state.activeId !== w.id);
  useLayoutEffect(() => {
    const box = root.current;
    if (!box) return;
    const measure = (): void => { const rect = box.getBoundingClientRect(); if (!rect.width || !rect.height) return; const next = { width: rect.width, height: rect.height }; setViewport(next); dispatch({ type: "viewport", viewport: next }); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(box); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const heldViewport = useRef(viewport); heldViewport.current = viewport;
  useEffect(() => { if (nav.openId) dispatch({ type: "open", id: nav.openId, viewport: heldViewport.current }); }, [nav.openId, p.request?.n]);
  useEffect(() => { if (p.request?.wing === null) dispatch({ type: "open", id: "chat", viewport: heldViewport.current }); }, [p.request?.n, p.request?.wing]);
  const { close: closeNav } = nav;
  const openId = useRef(nav.openId); openId.current = nav.openId;
  useEffect(() => {
    const box = root.current;
    const focus = (event: Event): void => {
      const id = (event.target as HTMLElement).closest<HTMLElement>("[data-desktop-window]")?.dataset.desktopWindow;
      if (!id) return;
      if (openId.current !== id) closeNav();
      dispatch({ type: "focus", id });
    };
    box?.addEventListener("pointerdown", focus); box?.addEventListener("focusin", focus);
    return () => { box?.removeEventListener("pointerdown", focus); box?.removeEventListener("focusin", focus); };
  }, [closeNav]);
  const dismiss = (w: Desktop98Window): void => { if (nav.openId === w.id) nav.close(); dispatch({ type: "minimize", id: w.id }); };
  const closeWindow = (w: Desktop98Window): void => { if (nav.openId === w.id) nav.close(); dispatch({ type: w.id === "chat" ? "minimize" : "close", id: w.id }); };
  const { onSurface } = p;
  useEffect(() => { onSurface(state.activeId !== null && state.activeId !== "chat"); return () => onSurface(false); }, [state.activeId, onSurface]);
  useEffect(() => {
    for (const w of state.windows) if (w.id !== "chat" && w.open && !p.programs.some((program) => program.id === w.id)) dispatch({ type: "close", id: w.id });
  }, [p.programs, state.windows]);
  const pointer = (event: PointerEvent<HTMLElement>, w: Desktop98Window, resize = false): void => {
    if ((event.target as HTMLElement).closest("button") || w.maximized || viewport.width <= 720) return;
    event.preventDefault();
    const target = event.currentTarget, x = event.clientX, y = event.clientY, bounds = w.bounds;
    target.setPointerCapture?.(event.pointerId);
    dispatch({ type: "focus", id: w.id });
    const move = (e: globalThis.PointerEvent): void => {
      const dx = e.clientX - x, dy = e.clientY - y;
      dispatch({ type: "bounds", id: w.id, viewport, bounds: resize ? resizeDesktop98Bounds(bounds, "se", dx, dy, viewport) : { ...bounds, x: bounds.x + dx, y: bounds.y + dy } });
    };
    const stop = (): void => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", stop); target.removeEventListener("pointercancel", stop); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", stop); target.addEventListener("pointercancel", stop);
  };
  const geometry = (w: Desktop98Window): CSSProperties => { const b = desktop98VisibleBounds(w, viewport); return { left: b.x, top: b.y, width: b.width, height: b.height, zIndex: 10 + w.z }; };
  const title = (w: Desktop98Window): string => w.id === "chat" ? `${p.name} | Bunzai Instant Messenger` : p.programs.find((program) => program.id === w.id)?.title ?? w.id;
  const heading = (w: Desktop98Window): JSX.Element => <header className="d98-title" onPointerDown={(e) => pointer(e, w)} onDoubleClick={() => dispatch({ type: "maximize", id: w.id })}>
    <Ic name={w.id === "chat" ? "lucide:message-square" : "lucide:app-window"} size={16} /><strong>{title(w)}</strong>
    <IconButton variant="quiet" size="sm" label={`Minimize ${title(w)}`} icon="lucide:minus" onClick={() => dismiss(w)} />
    <IconButton variant="quiet" size="sm" label={`${w.maximized ? "Restore" : "Maximize"} ${title(w)}`} icon="lucide:square" onClick={() => dispatch({ type: "maximize", id: w.id })} />
    <IconButton variant="quiet" size="sm" label={`Close ${title(w)}`} icon="lucide:x" onClick={() => closeWindow(w)} />
  </header>;
  const grip = (w: Desktop98Window): JSX.Element => <div className="d98-grip" aria-hidden="true" onPointerDown={(e) => pointer(e, w, true)} />;
  return <div ref={root} className="alt-layout desktop98" data-chat-layout="desktop98" onKeyDown={(e) => { if (isEscapeClose(e.nativeEvent)) setStart(false); }}>
    <div className="alt-backdrop">{p.backdrop}</div>
    <nav className="d98-icons" aria-label="Desktop programs">
      <Button variant="quiet" icon="lucide:message-square" onClick={() => open("chat")}>Instant Messenger</Button>
      <VirtualRows items={p.programs} keyOf={(program) => program.id} estimate={74} render={(program) => <Button variant="quiet" icon={program.icon} onClick={() => open(program.id)}>{program.title}</Button>} />
    </nav>
    <section className="d98-window d98-chat" data-desktop-window="chat" data-active={state.activeId === "chat"} style={geometry(chatWindow)} hidden={hidden(chatWindow)} onPointerDown={() => dispatch({ type: "focus", id: "chat" })} onFocus={() => dispatch({ type: "focus", id: "chat" })}>
      {heading(chatWindow)}<div className="d98-menu"><Button variant="quiet" size="sm" onClick={p.onBack}>Scenes</Button><Button variant="quiet" size="sm" onClick={() => open("model")}>AI Connection</Button><Button variant="quiet" size="sm" onClick={() => open("display")}>Control Panel</Button>{p.actions}</div>
      <div className="d98-conversation"><div className="d98-transcript">{p.children}</div>{chatBounds.width >= 600 && <aside className="d98-buddy">{p.portrait}<strong>{p.name}</strong></aside>}</div>
      <footer className="d98-status">Connected to your scene<span>Bunzai 98</span></footer>{grip(chatWindow)}
    </section>
    {/* bounded-ok: visited program windows, bounded by the scene's finite tools. */}
    {state.windows.filter((w) => w.id !== "chat").map((w) => <section key={w.id} className="d98-window" data-desktop-window={w.id} data-active={state.activeId === w.id} style={geometry(w)} hidden={hidden(w)} onPointerDown={() => dispatch({ type: "focus", id: w.id })} onFocus={() => dispatch({ type: "focus", id: w.id })}>
      {heading(w)}<div className="d98-program"><ProgramSlot holder={holderOf(w.id)} /></div>{grip(w)}
    </section>)}
    <ProgramPortals ids={nav.visited} programs={p.programs} holderOf={holderOf} render={p.renderProgram} />
    {start && <nav className="d98-start" aria-label="Start menu"><Button variant="quiet" onClick={p.onBack}>Back to Scenes</Button><VirtualRows items={p.programs} keyOf={(program) => program.id} estimate={40} render={(program) => <Button variant="quiet" icon={program.icon} onClick={() => open(program.id)}>{program.title}</Button>} /></nav>}
    <nav className="d98-taskbar" aria-label="Open programs"><Button variant="secondary" icon="lucide:panels-top-left" aria-expanded={start} onClick={() => setStart(!start)}>Start</Button>
      {/* bounded-ok: one task per open program, same finite catalog as the desktop. */}
      {state.windows.filter((w) => w.open).map((w) => <Button key={w.id} variant="secondary" aria-pressed={state.activeId === w.id && !w.minimized} onClick={() => hidden(w) || state.activeId !== w.id ? open(w.id) : dismiss(w)}>{w.id === "chat" ? "Instant Messenger" : title(w)}</Button>)}
    </nav>
  </div>;
}
