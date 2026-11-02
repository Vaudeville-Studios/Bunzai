/**
 * The paper layouts' geometry (Letters, Notebook, Storybook) over the shared reading layout styles (layout-style.ts).
 * Every colour is a theme token, so a light theme reads as paper on a desk and a dark one as the same page by lamplight.
 */
export const PAPER_LAYOUT_STYLE = `
.scs [data-chat-layout="letters"],.scs [data-chat-layout="notebook"],.scs [data-chat-layout="storybook"]{--paper-shadow:color-mix(in srgb,var(--stage-card) 38%,transparent);--paper-ink:var(--bk-role-brand-text)}
.scs [data-chat-layout="letters"] .pstamp,.scs [data-chat-layout="notebook"] .pstamp,.scs [data-chat-layout="storybook"] .pstamp{display:none!important}
.scs [data-chat-layout="letters"] .alt-header{background:linear-gradient(var(--stage-well) 72%,transparent);border-bottom:0}
.scs [data-chat-layout="storybook"] .alt-header{background:transparent}
.scs [data-chat-layout="letters"] .alt-now,.scs [data-chat-layout="storybook"] .alt-now{flex:1;align-items:center;text-align:center}
.scs [data-chat-layout="letters"] .alt-now small,.scs [data-chat-layout="notebook"] .alt-now small,.scs [data-chat-layout="storybook"] .alt-now small{color:var(--paper-ink);font-family:var(--font-fancy);font-style:italic;text-transform:none;letter-spacing:.02em}
.scs [data-chat-layout="letters"] .alt-now strong,.scs [data-chat-layout="storybook"] .alt-now strong{font-size:1.25em}
.scs [data-chat-layout="letters"] .alt-actions,.scs [data-chat-layout="storybook"] .alt-actions{margin-left:0}

.scs [data-chat-layout="letters"] .scroll>*{max-width:720px!important}
.scs [data-chat-layout="letters"] .msg{display:block!important;position:relative;left:-32px;margin:0 auto 40px!important;padding:34px 44px 26px!important;background:var(--stage-panel);border:1px solid var(--stage-seam)!important;box-shadow:0 2px 0 -1px var(--stage-panel),0 2px 0 0 var(--stage-seam),0 22px 40px -30px var(--paper-shadow)}
.scs [data-chat-layout="letters"] .msg.user{left:32px;background:var(--bk-surface-field)}
.scs [data-chat-layout="letters"] .msg>.pw{position:absolute!important;top:20px;right:22px;width:62px!important;flex:none}
.scs [data-chat-layout="letters"] .msg .por{width:62px!important;height:78px!important;outline:2px dashed var(--stage-seam);outline-offset:4px;transform:rotate(3deg)}
.scs [data-chat-layout="letters"] .msg .body{display:flex!important;flex-direction:column;padding-right:84px!important}
.scs [data-chat-layout="letters"] .msg .spk{order:9;align-self:flex-end;margin-top:14px;font:italic 500 1.15em/1.3 var(--font-fancy)!important;letter-spacing:0!important;text-transform:none!important;color:var(--paper-ink)!important}
.scs [data-chat-layout="letters"] .msg .spk::before{content:"\\2014\\00a0"}
.scs [data-chat-layout="letters"] .msg .meta{order:10}
.scs [data-chat-layout="letters"] .prose,.scs [data-chat-layout="storybook"] .prose{font-family:var(--font-body);line-height:1.8}

.scs [data-chat-layout="notebook"]{--nb-line:32px;--nb-margin:72px;--nb-tabs:156px}
.scs [data-chat-layout="notebook"] .alt-main{margin:14px calc(var(--nb-tabs) - 4px) 14px 18px;background:var(--stage-panel);border:1px solid var(--stage-seam);box-shadow:0 26px 50px -36px var(--paper-shadow);overflow:hidden}
.scs [data-chat-layout="notebook"] .alt-main::before{content:"";position:absolute;z-index:3;top:0;bottom:0;left:var(--nb-margin);width:2px;background:color-mix(in srgb,var(--bk-role-danger) 55%,transparent);pointer-events:none}
.scs [data-chat-layout="notebook"] .alt-main::after{content:"";position:absolute;z-index:3;top:18px;bottom:18px;left:18px;width:16px;background:radial-gradient(circle,var(--stage-well) 5px,var(--stage-seam) 6px,transparent 7px) center top/16px 44px repeat-y;pointer-events:none}
.scs [data-chat-layout="notebook"] .alt-header{background:var(--stage-panel);padding-left:calc(var(--nb-margin) + 18px)}
.scs [data-chat-layout="notebook"] .scroll{padding:24px 40px 160px calc(var(--nb-margin) + 24px)!important;background:linear-gradient(transparent calc(var(--nb-line) - 1px),color-mix(in srgb,var(--bk-role-action) 24%,transparent) 0) 0 23px/100% var(--nb-line) local}
.scs [data-chat-layout="notebook"] .scroll>*{max-width:none!important}
.scs [data-chat-layout="notebook"] .msg{gap:20px;margin-bottom:var(--nb-line)!important}
.scs [data-chat-layout="notebook"] .prose{line-height:var(--nb-line)}
.scs [data-chat-layout="notebook"] .spk{font:italic 600 1.05em/var(--nb-line) var(--font-fancy)!important;letter-spacing:0!important;text-transform:none!important;color:var(--paper-ink)!important}
.scs [data-chat-layout="notebook"] .msg>.pw{position:relative!important;flex-basis:92px;width:92px!important}
.scs [data-chat-layout="notebook"] .msg .por{width:84px!important;height:100px!important;border:6px solid var(--bk-surface-field)!important;border-bottom-width:20px!important;box-shadow:0 10px 18px -12px var(--paper-shadow);transform:rotate(-3deg)}
.scs [data-chat-layout="notebook"] .msg.user .por{transform:rotate(3deg)}
.scs [data-chat-layout="notebook"] .msg>.pw::before{content:"";position:absolute;z-index:1;top:-8px;left:22px;width:46px;height:16px;background:color-mix(in srgb,var(--bk-role-warn) 40%,transparent);transform:rotate(4deg)}
.scs [data-chat-layout="notebook"] .dockbar{left:calc(var(--nb-margin) + 8px)!important}
.scs .nb-tabs{position:absolute;z-index:4;top:72px;right:0;width:var(--nb-tabs);overflow:hidden auto;max-height:calc(100% - 96px)}
.scs .nb-tabs .alt-tools{display:flex;flex-direction:column;gap:4px;padding:0}
.scs .nb-tabs [data-control="row"]{min-height:40px;padding-left:14px;border:1px solid var(--stage-seam);border-left:0;background:color-mix(in srgb,var(--row-accent) 32%,var(--stage-panel));color:var(--stage-card);transform:translateX(6px);transition:transform var(--bk-dur-fast) var(--bk-ease-move)}
.scs .nb-tabs [data-control="row"]:hover{transform:translateX(0)}
.scs .nb-tabs [data-control="row"][data-selected]{transform:translateX(-4px);background:color-mix(in srgb,var(--row-accent) 60%,var(--stage-panel));box-shadow:-6px 0 0 color-mix(in srgb,var(--row-accent) 60%,var(--stage-panel))}
.scs [data-chat-layout="notebook"] .alt-familiar-drawer{z-index:41;left:auto;right:var(--nb-tabs);top:22px;bottom:22px;width:min(540px,46cqw);background:var(--stage-panel);box-shadow:-18px 0 40px -30px var(--paper-shadow)}

.scs [data-chat-layout="storybook"]{background:radial-gradient(ellipse at 50% 40%,var(--stage-floor),var(--stage-well) 75%)}
.scs .sb-book{position:absolute;inset:16px 28px 18px;display:flex;max-width:1560px;margin:0 auto;box-shadow:3px 3px 0 -1px var(--stage-panel),3px 3px 0 0 var(--stage-seam),6px 6px 0 -1px var(--stage-panel),6px 6px 0 0 var(--stage-seam),0 40px 60px -40px var(--paper-shadow)}
.scs .sb-page{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background-color:var(--stage-panel);border:1px solid var(--stage-seam)}
.scs .sb-left{flex:0 0 clamp(300px,32cqw,460px);border-right:0;background-image:linear-gradient(90deg,transparent 82%,color-mix(in srgb,var(--stage-card) 9%,transparent))}
.scs .sb-page.alt-main{flex:1;border-left:0;background-image:linear-gradient(90deg,color-mix(in srgb,var(--stage-card) 11%,transparent),transparent 7%)}
.scs .sb-contents{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:22px;padding:34px 30px}
.scs .sb-portrait{margin:0;display:flex;flex-direction:column;align-items:center;gap:14px}
.scs .sb-portrait .por{position:relative!important;inset:auto!important;width:220px!important;height:300px!important;border:1px solid var(--stage-line);box-shadow:inset 0 0 0 7px var(--stage-panel),inset 0 0 0 8px var(--stage-seam)}
.scs .sb-portrait figcaption{font:500 1.5em/1.2 var(--font-fancy);text-align:center;overflow-wrap:anywhere}
.scs .sb-contents .alt-tools{width:100%;padding:0;display:flex;flex-direction:column}
.scs .sb-contents .alt-tools>small{display:flex;align-items:center;gap:12px;margin-bottom:6px;font:italic var(--text-meta) var(--font-fancy);color:var(--paper-ink)}
.scs .sb-contents .alt-tools>small::before,.scs .sb-contents .alt-tools>small::after{content:"";flex:1;border-top:1px solid var(--stage-seam)}
.scs .sb-contents [data-control="row"]{background:transparent;border-bottom:1px dotted var(--stage-seam)}
.scs .sb-contents [data-control="row"] [data-slot="leading"]{color:color-mix(in srgb,var(--row-accent) 60%,var(--stage-card))}
.scs [data-chat-layout="storybook"] .alt-main .alt-header{border-bottom:1px solid var(--stage-seam);margin:0 32px}
.scs [data-chat-layout="storybook"] .scroll>*{max-width:740px!important}
.scs [data-chat-layout="storybook"] .msg>.pw{display:none}
.scs [data-chat-layout="storybook"] .spk{font:600 var(--text-meta) var(--font-fancy)!important;letter-spacing:.2em!important;text-transform:uppercase!important;color:var(--paper-ink)!important;text-align:center!important}
.scs [data-chat-layout="storybook"] .prose .blk+.blk{text-indent:1.6em}
.scs [data-chat-layout="storybook"] .msg.user .prose{font-style:italic;color:var(--stage-soft)}
@container (max-width:1023px){
.scs .sb-book{inset:0;box-shadow:none}.scs .sb-page.alt-main{border:0;background-image:none}
.scs [data-chat-layout="storybook"] .msg>.pw{display:block;flex-basis:52px;width:52px!important}.scs [data-chat-layout="storybook"] .msg .por{width:52px!important;height:66px!important}
.scs [data-chat-layout="notebook"] .alt-main{margin:0 calc(var(--nb-tabs) - 4px) 0 0}
}
@container (max-width:720px){
.scs [data-chat-layout="letters"] .msg,.scs [data-chat-layout="letters"] .msg.user{left:0;margin:0 0 28px!important;padding:22px 20px 18px!important}
.scs [data-chat-layout="letters"] .msg>.pw{top:14px;right:14px;width:44px!important}.scs [data-chat-layout="letters"] .msg .por{width:44px!important;height:56px!important}
.scs [data-chat-layout="letters"] .msg .body{padding-right:56px!important}
.scs [data-chat-layout="notebook"]{--nb-margin:40px}.scs .nb-tabs{display:none}.scs [data-chat-layout="notebook"] .alt-main{margin:0}
.scs [data-chat-layout="notebook"] .alt-main::after{display:none}.scs [data-chat-layout="notebook"] .scroll{padding:16px 14px 145px calc(var(--nb-margin) + 12px)!important}
.scs [data-chat-layout="notebook"] .msg>.pw{flex-basis:56px;width:56px!important}.scs [data-chat-layout="notebook"] .msg .por{width:52px!important;height:62px!important;border-width:4px!important;border-bottom-width:12px!important}
}
`;
