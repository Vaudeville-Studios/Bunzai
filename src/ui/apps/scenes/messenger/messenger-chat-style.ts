/**
 * The scene's own chat wearing the Messenger look (RoleCall discord.css:56-90, which restyles RoleCall's transcript and composer in place): the same markup, filling the body beside the open panel or the member list, messages as an avatar and a name over plain text with no bubble, and the composer as a rounded input box. Every selector is rooted `:root .scs .msn-chat`
 * so it outranks the scene's own sheets, including the ones scoped to RoleCall's chrome. Colors are the stage tokens pointed at the Messenger palette (messenger-style.ts).
 */
const C = ":root .scs .msn-chat";

export const MESSENGER_CHAT_STYLE = `
${C}{position:relative;flex:1 1 0;min-width:0;min-height:0;z-index:40;background:var(--msg-chat)}
${C}[hidden]{display:none}
${C}:has(.find){z-index:54}
${C}>.chat{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--msg-chat);transition:none}
${C}>.chat>.scroll{position:static;flex:1 1 auto;min-height:0;padding:20px 24px;color:var(--msg-text)}
${C} .msg,${C} .msg.user{flex-direction:row;gap:16px;margin:0;padding:10px 0 14px;animation:none}
${C} .msg .pw{position:static!important;flex:0 0 40px!important;width:40px!important;height:auto!important;max-width:40px!important;overflow:visible;border-radius:0;box-shadow:none}
${C} .msg .pw .por{position:relative!important;inset:auto!important;width:40px!important;height:40px!important;min-width:40px;max-width:40px;aspect-ratio:1;border-radius:50%!important;overflow:hidden;background:var(--msg-brand);box-shadow:none}
${C} .msg .pw .por::before{display:none}
${C} .msg .pw .por .ini{font:700 13px var(--font-body)!important;color:var(--msg-white)}
/* the time sits after the name, not under the avatar (discord.css:79-80, .message-header and .message-timestamp) */
${C} .msg .pw .pstamp{display:none}
${C} .msg .spk,${C} .msg.user .spk{display:inline-block}
${C} .msg .spk-time[hidden]{display:inline;margin-left:8px;font:400 11px/1.4 var(--font-body);color:var(--msg-faint)}
${C} .msg .body,${C} .msg.user .body{padding:0}
${C} .msg .bnum,${C} .msg.user .bnum{justify-content:flex-start}
${C} .msg.user .badge{float:none}
${C} .msg .spk,${C} .msg.user .spk{margin:0 0 4px;text-align:left;font:600 15px/1.4 var(--font-body);letter-spacing:0;text-transform:none;color:var(--msg-bright);text-shadow:none}
${C} .msg .bub,${C} .msg.user .bub{padding:0;border:0;border-radius:0;background:none}
${C} .msg .bub::before{display:none}
${C} .msg .prose,${C} .msg.user .prose{font:400 16px/1.6 var(--font-body);color:var(--msg-text);text-shadow:none}
${C} .msg .prose em{color:var(--msg-mute)}
${C} .msg .prose q{color:var(--msg-pill-text)}
${C} .msg .prose a{color:var(--msg-link)}
${C} .msg .prose pre{background:var(--msg-side);border:1px solid var(--msg-rail);border-radius:4px;color:var(--msg-text)}
${C}>.chat>.dockbar{position:static;flex:0 0 auto;padding:8px 20px 20px;padding-bottom:max(20px,env(safe-area-inset-bottom))}
${C}>.chat>.dockbar .cap{max-width:none;margin:0;gap:6px;padding:6px;border:0;border-radius:calc(var(--msn-radius) * 1.5);background:var(--msg-input);backdrop-filter:none;box-shadow:none}
${C}>.chat>.dockbar .cap textarea{align-self:stretch;padding:10px 8px;border-radius:6px;background:var(--msg-input);color:var(--msg-text);font:16px/1.4 var(--font-body)}
${C}>.chat>.dockbar .cap textarea::placeholder{color:var(--msg-faint)}
${C}>.chat>.dockbar .cap :is(.tools,.send,.stop){align-self:flex-end;border:0;border-radius:6px;background:var(--msg-input);color:var(--msg-text);box-shadow:none}
${C} .greet{background:var(--msg-side);border-color:var(--msg-active);border-radius:8px;backdrop-filter:none}
/* runs, day dividers, role pills and the reply line (backlog slices 6 and 7): after the rules above so equal specificity falls to these */
${C} .msg.grp{padding-top:2px}
${C} .msg.runmore{padding-bottom:2px}
/* an open message menu is fixed-position: content-visibility would clip it and make the message its containing block (same as scene-history-style.ts) */
${C} .msg:has(.msn-ctx){content-visibility:visible;z-index:30}
${C} .msg.grp .pw>:not(.gt),${C} .msg.grp .spk,${C} .msg.grp .spk-time[hidden],${C} .msg.grp .rb,${C} .msg.grp .reply{display:none}
${C} .msg .gt{display:block;visibility:hidden;padding-top:3px;text-align:center;font:400 10px/1.2 var(--font-body);color:var(--msg-faint)}
${C} .msg:hover .gt{visibility:visible}
${C} .msg .rb{display:inline-block;margin-left:8px;padding:0 6px;border-radius:calc(var(--msn-radius) / 2);vertical-align:middle;background:var(--msg-pill);color:var(--msg-pill-text);font:700 11px/16px var(--font-body)}
${C} .msg .reply{display:flex;align-items:center;gap:6px;min-width:0;margin:0 0 4px;font:400 13px/1.4 var(--font-body);color:var(--msg-faint)}
${C} .msg .reply .cn{flex:none;width:18px;height:9px;margin-top:6px;border-left:2px solid var(--msg-close-ring);border-top:2px solid var(--msg-close-ring);border-top-left-radius:8px}
${C} .msg .reply b{flex:none;font-weight:600;color:var(--msg-mute)}
${C} .msg .reply .rt{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
${C} .datesep{display:flex;align-items:center;gap:12px;margin:8px 0 4px;font:700 12px var(--font-body);color:var(--msg-faint)}
${C} .datesep::before,${C} .datesep::after{content:"";flex:1;height:1px;background:var(--msg-divider)}
${C} .datesep.fresh{color:var(--msg-unread)}
${C} .datesep.fresh::before,${C} .datesep.fresh::after{background:var(--msg-unread)}
@container (max-width:640px){
${C}>.chat>.scroll{padding:12px}
${C}>.chat>.dockbar{padding:6px 10px 12px}
/* the message menu is a bottom sheet here (long press) */
${C} .msn-ctx{left:0!important;right:0;top:auto!important;bottom:0}
${C} .msn-ctx .msn-menu{width:auto;max-width:none;max-height:70vh;overflow:auto;border-radius:calc(var(--msn-radius) * 2) calc(var(--msn-radius) * 2) 0 0}
${C} .msn-ctx .msn-menu-sub{position:static;margin:4px 0 0}
}
`;
