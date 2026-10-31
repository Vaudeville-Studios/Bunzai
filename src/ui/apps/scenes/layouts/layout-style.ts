/** VAUDEVILLE layout geometry adapted to Bunzai tokens, shared messages and container queries. */
export const ADDITIONAL_LAYOUT_STYLE = `
.scs:has(>.alt-layout),.scs:has(>style+.alt-layout){isolation:isolate}
.scs .alt-layout{position:absolute;inset:0;display:flex;min-width:0;min-height:0;container-type:inline-size;background:var(--stage-well);color:var(--stage-card)}
.scs .alt-backdrop{position:absolute;inset:0;z-index:-1;pointer-events:none}
.scs .alt-main{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;position:relative}
.scs .alt-header{display:flex;align-items:center;gap:12px;flex:none;min-height:64px;padding:10px 20px;border-bottom:1px solid var(--stage-line);background:color-mix(in srgb,var(--stage-floor) 90%,transparent);z-index:2}
.scs .alt-now{display:flex;flex-direction:column;min-width:0}.scs .alt-now small{text-transform:uppercase;letter-spacing:.18em;font:var(--text-meta) var(--font-mono);color:var(--accent)}
.scs .alt-now strong{font-family:var(--font-fancy);overflow-wrap:anywhere}.scs .alt-actions{margin-left:auto;display:flex;gap:8px;min-width:0}
.scs .alt-chat,.scs .d98-transcript{position:relative;flex:1;min-width:0;min-height:0}
.scs .alt-layout .chat{position:absolute!important;inset:0!important}
.scs .alt-layout .scroll{inset:0!important;padding:28px 32px 160px!important}
.scs .alt-layout .scroll>*{max-width:1200px!important;margin-left:auto!important;margin-right:auto!important}
.scs .alt-layout .msg{display:flex!important;gap:24px;padding:0!important;margin-bottom:32px!important;border:0!important;content-visibility:visible}
.scs .alt-layout .msg.user{flex-direction:row!important}
.scs .alt-layout .msg>.pw{position:static!important;flex:0 0 200px;width:200px!important;height:auto!important;max-width:none!important;overflow:visible!important}
.scs .alt-layout .msg .por{position:relative!important;inset:auto!important;width:200px!important;height:280px!important;max-width:none!important}
.scs .alt-layout .msg .body{flex:1!important;min-width:0;max-width:none!important;padding:0!important}
.scs .alt-layout .spk{white-space:normal!important;overflow:visible!important;text-overflow:clip!important;text-align:left!important}
.scs .alt-layout .bub{max-width:none!important;width:auto!important}.scs .alt-layout .prose{max-width:none!important}
.scs .alt-layout .dockbar{left:0!important;right:0!important;bottom:0!important;transform:none!important;padding:12px 24px!important;max-width:none!important}
.scs .alt-layout .hudline{display:none}
.scs .alt-rail{flex:0 0 60px;z-index:3;overflow:auto;background:color-mix(in srgb,var(--stage-floor) 90%,transparent);border-right:1px solid var(--stage-line)}
.scs .alt-rail .alt-tools{display:flex;flex-direction:column;padding:8px 4px;gap:6px}.scs .alt-rail [data-control="row"]{min-height:46px}
.scs .alt-rail [data-control="row"] [data-slot="label"]{display:none}
.scs [data-chat-layout="familiar"]{--familiar-panel:clamp(260px,30cqw,520px)}
.scs [data-chat-layout="familiar"] .alt-main{margin-left:var(--familiar-panel)}
.scs .alt-familiar-drawer{position:absolute;left:60px;top:8px;bottom:8px;width:var(--familiar-panel);display:flex;flex-direction:column;overflow:hidden;background:color-mix(in srgb,var(--stage-panel) 90%,transparent);border:1px solid var(--stage-line);z-index:5}
.scs [data-chat-layout="familiar"] .spk{font:600 16px/1.5 var(--font-body);letter-spacing:0;text-transform:none}
.scs [data-chat-layout="familiar"] .scroll{padding:28px 28px 150px!important}
.scs [data-chat-layout="familiar"] .scroll>*{max-width:none!important}
.scs [data-chat-layout="familiar"] .msg>.pw{flex-basis:52px;width:52px!important}
.scs [data-chat-layout="familiar"] .msg .por{width:52px!important;height:64px!important}
.scs [data-chat-layout="familiar"] .bub{background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important}
.scs [data-chat-layout="immersive"] .alt-header{background:transparent;border:0;opacity:.85}
.scs [data-chat-layout="immersive"] .msg:not(.user)>.pw{flex-basis:260px;width:260px!important}
.scs [data-chat-layout="immersive"] .msg:not(.user) .por{width:260px!important;height:380px!important}
.scs [data-chat-layout="immersive"] .bub{background:color-mix(in srgb,var(--stage-floor) 65%,transparent)!important;backdrop-filter:blur(12px);border:0!important;padding:28px!important}
.scs .alt-drawer{position:relative;width:min(760px,95cqw);height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--stage-panel);color:var(--stage-card)}
.scs .alt-scrim{justify-content:flex-end;padding:0;background:color-mix(in srgb,var(--stage-black) 40%,transparent)}
.scs .alt-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--stage-line)}
.scs .alt-panel-body{flex:1;min-height:0;overflow:auto;position:relative}.scs .alt-tools{padding:12px}
.scs .alt-layout .msn-slot,.scs .alt-layout .msn-prog{height:100%;min-height:0;position:relative}
.scs .alt-layout .wing-panel,.scs .alt-drawer .wing-panel{position:relative!important;inset:auto!important;width:100%!important;height:100%!important;padding:0!important;border:0!important;display:flex!important;flex-direction:column;transform:none!important;box-shadow:none!important;opacity:1!important;pointer-events:auto!important}
.scs .alt-layout .wing-panel>.wbody,.scs .alt-drawer .wing-panel>.wbody{flex:1;min-height:0;overflow:auto}
.scs .desktop98{--d98-hi:var(--d98-paper);--d98-title:var(--d98-title-blue);--accent:var(--d98-title-blue);--stage-card:var(--d98-ink);--stage-soft:var(--d98-ink);--stage-mute:var(--d98-edge);--stage-line:var(--d98-edge);--stage-floor:var(--d98-paper);--stage-panel:var(--d98-face);--stage-well:var(--d98-desktop);--text:var(--d98-ink);--text-soft:var(--d98-ink);--chrome:var(--d98-face);--control-boundary:var(--d98-edge);--stamp-shadow:var(--d98-edge);--bk-text:var(--d98-ink);--bk-text-soft:var(--d98-ink);--bk-surface-panel:var(--d98-face);--bk-surface-field:var(--d98-paper);display:block;background:var(--d98-desktop);font-family:var(--font-body)}
.scs .d98-icons{position:absolute;inset:8px auto 42px 8px;width:112px;overflow:auto}
.scs .d98-icons [data-control="button"]{width:100%;min-height:70px;display:flex;flex-direction:column;white-space:normal;font-size:var(--text-meta)}
.scs .d98-window{position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;padding:3px;border:2px outset var(--stage-line);background:var(--d98-face);box-shadow:2px 2px 0 var(--stage-black);overflow:hidden}
.scs .d98-window[hidden]{display:none}
.scs .d98-title{display:flex;align-items:center;gap:6px;flex-shrink:0;min-height:30px;padding:2px 4px;touch-action:none;background:var(--stage-mute);color:var(--d98-hi);user-select:none}
.scs .d98-window[data-active="true"]>.d98-title{background:linear-gradient(90deg,var(--d98-title),var(--d98-title-end))}
.scs .d98-title strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-meta)}
.scs .d98-menu{display:flex;align-items:center;gap:4px;flex:none;flex-wrap:wrap;border-bottom:1px solid var(--stage-line);min-height:30px}
.scs .d98-conversation{display:flex;flex:1;min-height:0}.scs .d98-transcript{background:var(--stage-floor)}
.scs .desktop98 .msg .bub,.scs .desktop98 .msg .prose{color:var(--d98-ink)!important;text-shadow:none!important}
.scs .desktop98 .msg .spk{color:var(--d98-title-blue)!important;text-shadow:none!important}.scs .desktop98 .msg .prose q{color:var(--d98-title-blue)!important}
.scs .d98-buddy{flex:0 0 144px;padding:12px;display:flex;flex-direction:column;gap:12px;align-items:center;overflow:auto;overflow-wrap:anywhere;font-size:var(--text-meta)}
.scs .d98-buddy .por{position:relative!important;width:120px!important;height:170px!important;top:0!important}
.scs .d98-status{display:flex;justify-content:space-between;flex:none;padding:4px;border:1px inset var(--stage-line);font-size:var(--text-meta)}
.scs .d98-program{flex:1;min-height:0;overflow:auto;position:relative}.scs .d98-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:se-resize;touch-action:none;border-right:3px double var(--stage-line);border-bottom:3px double var(--stage-line)}
.scs .desktop98 .scroll{padding:16px 18px 130px!important}.scs .desktop98 .msg{gap:8px;margin-bottom:24px!important}
.scs .desktop98 .msg>.pw{display:none}.scs .desktop98 .bub{background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important}
.scs .desktop98 .spk{font-family:var(--font-body)!important;font-size:var(--text-body)!important;letter-spacing:0!important;text-transform:none!important}
.scs .desktop98 .dockbar{padding:10px!important;background:var(--d98-face)}.scs .desktop98 .cap{padding:8px!important;border:2px inset var(--stage-line)!important}
.scs .d98-taskbar{position:absolute;inset:auto 0 0;display:flex;gap:6px;align-items:center;padding:3px;height:38px;z-index:1000;background:var(--d98-face);border-top:2px outset var(--stage-line);overflow-x:auto;white-space:nowrap}
.scs .d98-taskbar>*{flex-shrink:0}.scs .d98-start{position:absolute;left:0;bottom:38px;width:280px;height:min(480px,80%);overflow:auto;background:var(--d98-face);border:2px outset var(--stage-line);z-index:1001;padding:8px}
.scs .d98-start [data-control="button"]{width:100%;justify-content:flex-start}
@container (max-width:1023px){.scs [data-chat-layout="familiar"] .alt-main{margin-left:0}}
@container (max-width:720px){
.scs .alt-header{padding:8px;gap:6px;min-height:56px}.scs .alt-actions{max-width:40%}.scs .alt-now small{display:none}
.scs .alt-layout .scroll{padding:16px 12px 145px!important}.scs .alt-layout .msg{gap:12px}
.scs .alt-layout .msg>.pw,.scs [data-chat-layout="immersive"] .msg:not(.user)>.pw{flex-basis:80px;width:80px!important}
.scs .alt-layout .msg .por,.scs [data-chat-layout="immersive"] .msg:not(.user) .por{width:80px!important;height:112px!important}
.scs [data-chat-layout="familiar"] .msg>.pw{flex-basis:40px;width:40px!important}.scs [data-chat-layout="familiar"] .msg .por{width:40px!important;height:48px!important}
.scs .alt-rail{display:none}.scs .alt-layout .dockbar{padding:8px!important}.scs [data-chat-layout="immersive"] .bub{padding:12px!important}
.scs .d98-grip{display:none}.scs .d98-icons{width:90px}.scs .d98-menu{max-height:60px;overflow:auto}
}
`;
