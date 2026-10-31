/**
 * Mutations for the theme mod guards (styles, fonts, images, slots, protected layer, lifecycle). Each breaks one
 * guard; the named tests must fail. Kept apart from mutations.ts so that file stays about the library.
 */
import type { NamedMutation } from "./mutation-core";

const CSS = "src/extensions/theme-css.ts";
const BIN = "src/extensions/theme-binary.ts";
const SLOT = "src/extensions/slot-registry.ts";
const CONTRACT = "src/extensions/theme-contract.ts";
const LIFE = "src/extensions/runtime/theme-service.ts";
const DOG = "src/ui/shell/protected-watchdog.ts";
const MOD = "src/ui/shell/theme-mod.ts";
const PKG = ["src/extensions/theme-mods.test.ts", "src/extensions/theme-contract.test.ts"];
const LIFETESTS = ["src/ui/server-theme-extensions.test.ts", "src/extensions/runtime/service.test.ts"];
const DOGTESTS = ["src/ui/shell/protected-watchdog.test.ts", "src/ui/shell/theme-mods.test.ts"];
const APPLY = ["src/ui/shell/theme-mods.test.ts"];
const WATCH = ["src/ui/shell/theme-mod-watch.test.ts"];
const BROWSER = ["src/ui/shell/protected-browser.test.ts"];
const DIALOG = "src/ui/_shared/protected-dialog.tsx";
const DIALOGTESTS = ["src/ui/_shared/protected-dialog.test.tsx"];
const TOKENS = "src/ui/theme/tokens.css";
const one = (name: string, file: string, find: string, replace: string, tests: string[]): NamedMutation => ({ name: "theme mods: " + name, edits: [{ file, find, replace }], tests });

export const THEME_MOD_MUTANTS: NamedMutation[] = [
  one("a forbidden at-rule is accepted", CSS, 'else fail("@" + at.slice(0, 24) + " is not allowed");', "else readBlock();", PKG),
  one("the protected-layer names are no longer refused", CSS, 'v.includes("host-protected") || v.includes("bk-protected")', "false", PKG),
  one("--host-* properties are allowed", CSS, 'v.startsWith("--host-")', "false", PKG),
  one("loading functions (image-set, src, expression) are allowed", CSS, 't.type === "function" && BANNED_FUNCTIONS.has(v)', "false", PKG),
  one("an external url() is allowed", CSS, 'if (t.type === "url") return ASSET_URL.exec(t.value)?.[1] ?? fail("url() may only name a package asset, as url(asset:id)");', 'if (t.type === "url") return ASSET_URL.exec(t.value)?.[1] ?? null;', PKG),
  { ...one("nested rules are allowed", CSS, 'if (t.type === "{") fail("nested rules are not supported");', "", PKG), expectSurvives: "the unbalanced-brace check at the rule level refuses the same input one step later" },
  one("@font-face may take a host family", CSS, "if (HOST_FONT_FAMILIES.includes(family) || GENERIC_FAMILIES.has(family)) fail(", "if (false) fail(", PKG),
  one("@keyframes may reuse a host animation name", CSS, "if (HOST_KEYFRAMES.includes(names[0]!.value.toLowerCase())) fail(", "if (false) fail(", PKG),
  one("class attribute selectors may match by fragment", CSS, '"^$*|".includes(op.value) && all[i + 3]?.value === "="', "false", PKG),
  one("@font-face may have several sources or local()", CSS, "if (urls.length !== 1 || extra.length > 0) fail(", "if (false) fail(", PKG),
  one("styles have no size cap", CSS, "if (new TextEncoder().encode(css).byteLength > MAX_STYLES_BYTES) fail(", "if (false) fail(", PKG),
  one("strings are allowed as any function argument", CSS, "!STRING_FUNCTIONS.has(open[open.length - 1]!)", "false", PKG),
  one("at-rules may nest without limit", CSS, "if (nested >= MAX_AT_DEPTH) fail(", "if (false) fail(", PKG),
  one("a class used only in a compound counts as defined", CSS, "if (p.length === 2 &&", "if (p.length >= 2 &&", PKG),
  one("selectors are no longer scoped off the protected layer", CSS, "    edits.push({ start: pos, end: pos, text: PROTECTED_SCOPE });", "", [...PKG, ...APPLY]),
  one("PNG checksums are not checked", BIN, "if (crc32(b.subarray(at + 4, at + 8 + len)) !== u32be(b, at + 8 + len)) fail();", "", PKG),
  one("PNG dimensions are not bounded", BIN, "!sizeOk(u32be(b, at + 8), u32be(b, at + 12))", "false", PKG),
  one("a PNG may carry trailing bytes", BIN, "if (len !== 0 || at !== b.length || idat === 0) fail();", "if (len !== 0 || idat === 0) fail();", PKG),
  one("base64 need not be canonical", BIN, "return btoa(back) === text ? bytes : fail();", "return bytes;", PKG),
  one("animated WebP is allowed", BIN, "(b[body]! & 0x02) !== 0 ||", "", PKG),
  one("woff2 length is not checked", BIN, "u32be(b, 8) !== b.length", "false", PKG),
  one("binary files have no size cap", BIN, 'if (bytes.length > (media === "font/woff2" ? MAX_FONT_BYTES : MAX_RASTER_BYTES)) fail();', "", PKG),
  one("a slot class need not be defined by the styles", SLOT, "|| !classes.has(item.class)", "", PKG),
  one("slots have no total cap", SLOT, "if (total > MAX_SLOT_ITEMS_TOTAL) fail(", "if (false) fail(", PKG),
  one("slot text may carry control and bidi characters", SLOT, "|| UNSAFE_TEXT.test(item.text)", "", PKG),
  one("a slot class may use a host class name", SLOT, "const CLASS_NAME = /^mod-[a-z0-9][a-z0-9-]{0,35}$/;", "const CLASS_NAME = /^[a-z][a-z0-9-]{0,39}$/;", PKG),
  one("a slot image may name an undeclared asset", SLOT, "|| !imageIds.has(item.asset)", "", PKG),
  one("requested scopes need not match derived scopes", CONTRACT, "if (requestedScopes.length !== derivedScopes.length || requestedScopes.some((s, i) => s !== derivedScopes[i])) return fail();", "", PKG),
  one("a declared font need not be used", CONTRACT, "if (declaredFonts.some((f) => !report.fontIds.has(f.id))) return fail();", "", PKG),
  one("the package transport cap is not enforced", CONTRACT, "if (total > MAX_TRANSPORT_BYTES) fail();", "", PKG),
  one("the digest ignores the styles", CONTRACT, "...(styles !== null ? { styles } : {}),", "", PKG),
  one("safe mode does not resolve to core", LIFE, 'if (options.safeThemes || faulted) return core("disabled");', "if (false) return core(\"disabled\");", LIFETESTS),
  one("a stale digest can mark a theme broken", LIFE, "if (\"fallback\" in found || found.preview.digest !== digest) return false;", 'if ("fallback" in found) return false;', LIFETESTS),
  one("a broken-theme report never activates fallback mode", LIFE, "faulted = true;\n      healthRevision++;", "faulted = false;\n      healthRevision++;", LIFETESTS),
  one("a file is served for any digest", LIFE, "if (\"fallback\" in found || found.preview.digest !== digest) return null;", 'if ("fallback" in found) return null;', ["src/extensions/runtime/service.test.ts", "src/ui/server-theme-extensions.test.ts"]),
  one("unapproved theme assets remain available", LIFE, 'const image = found.control.themeScopes.includes("appearance.assets") ? found.preview.assets.find((item) => item.id === assetId) : undefined;', 'const image = found.preview.assets.find((item) => item.id === assetId);', LIFETESTS),
  one("stored data widened behind the lifecycle serves", LIFE, "|| control.themeScopes.some((scope) => !inspected.theme!.derivedScopes.includes(scope))", "", LIFETESTS),
  one("the watchdog blames the mod for host offenses too", DOG, "return withMod.filter((o) => !baseline.some((b) => b.kind === o.kind && b.node === o.node) && !hostPositioned(o));", "return withMod;", DOGTESTS),
  one("the mod stays off after a check", DOG, "} finally { setModEnabled(true); }", "} finally { /* left off */ }", DOGTESTS),
  one("opacity is not checked", DOG, "if (Number(s.opacity) < 0.5)", "if (false)", DOGTESTS),
  one("display is not checked", DOG, 'if (s.display === "none")', "if (false)", DOGTESTS),
  one("visibility is not checked", DOG, 'if (s.visibility === "hidden" || s.visibility === "collapse")', "if (false)", DOGTESTS),
  one("filter is not checked", DOG, 'if (s.filter !== "none" && s.filter !== "")', "if (false)", DOGTESTS),
  one("clip-path is not checked", DOG, 'if (s.clipPath !== "none" && s.clipPath !== "")', "if (false)", DOGTESTS),
  one("mask is not checked", DOG, 'if (s.maskImage !== "none" && s.maskImage !== "")', "if (false)", DOGTESTS),
  one("blend mode is not checked", DOG, 'if (s.mixBlendMode !== "normal" && s.mixBlendMode !== "")', "if (false)", DOGTESTS),
  one("root font size is not checked", DOG, "if (parseFloat(s.fontSize) < MIN_FONT_PX)", "if (false)", DOGTESTS),
  one("pointer-events on the surface is not checked", DOG, 'if (probe.style(surface).pointerEvents === "none")', "if (false)", DOGTESTS),
  one("hit testing is not done", DOG, "if (!hit || !inside(probe, surface, hit))", "if (false)", DOGTESTS),
  one("size and position are not checked", DOG, "if (b.width < MIN_SIDE || b.height < MIN_SIDE || right - left < MIN_SIDE || bottom - top < MIN_SIDE) {", "if (false) {", DOGTESTS),
  one("a click-through overlay element is not seen", DOG, 'if (covers(box)) out.push({ kind: "overlay", node: el });', 'if (false) out.push({ kind: "overlay", node: el });', DOGTESTS),
  one("an overlay pseudo-element is not seen", DOG, "if (parseFloat(p.width) * parseFloat(p.height) >= vw * vh * COVER_SHARE)", "if (false)", DOGTESTS),
  one("a broken mod is applied again for the same digest", MOD, "|| theme.digest === suppressed) { removeMod(); return; }", ") { removeMod(); return; }", APPLY),
  one("a broken mod is not remembered", MOD, "  suppressed = info.digest;\n", "", APPLY),
  one("a broken mod is not reported", MOD, "  handlers?.broken(info);\n", "", APPLY),
  one("removing the mod leaves the slots", MOD, "  document.documentElement.removeAttribute(SLOT_ATTRIBUTE);\n  document.documentElement.style.removeProperty(TYPE_PIN_PROPERTY);\n  stopWatching();", "  document.documentElement.style.removeProperty(TYPE_PIN_PROPERTY);\n  stopWatching();", APPLY),
  one("the renderer trusts the styles it is sent", "src/ui/shell/theme.ts", "checkThemeCss(value.styles, { images: imageIds, fonts: fontIds }).classes;", "new Set<string>(Array.from(value.styles.matchAll(/\\.([a-z-]+)/g), (m) => m[1]!));", APPLY),
  one("the protected layer loses its !important", "src/ui/theme/tokens.css", "visibility: visible !important; pointer-events: auto !important;", "visibility: visible; pointer-events: auto;", ["src/ui/theme/tokens.test.ts"]),
  one("the broken report is ignored by the route", "src/ui/server-theme-extensions.ts", "await service.markBroken(input.id, input.digest); return json({ ok: true });", "return json({ ok: true });", ["src/ui/server-theme-mods.test.ts"]),
  one("the page CSP allows external images", "src/ui/server-security.ts", "\"img-src 'self' data: blob:; connect-src 'self'; \"", "\"img-src 'self' data: blob: https:; connect-src 'self'; \"", ["src/ui/server-theme-mods.test.ts"]),
  // the top layer, the type pin and when the watchdog looks
  one("a modal prompt opens without the top layer", DIALOG, "if (!el.open) el.showModal();", "if (!el.open) el.show();", DIALOGTESTS),
  one("Escape dismisses a modal prompt", DIALOG, "onCancel={(e) => { e.preventDefault(); }}", "onCancel={() => undefined}", DIALOGTESTS),
  one("a stray close leaves a modal prompt closed", DIALOG, "onClose={() => { const el = ref.current; if (el && !el.open) el.showModal(); }}", "onClose={() => undefined}", DIALOGTESTS),
  one("a modal prompt stays under the page root instead of the body", DIALOG, "return client ? createPortal(dialog, document.body) : dialog;", "return dialog;", DIALOGTESTS),
  one("the stage door is not a protected dialog", "src/ui/shell/library-gate.tsx", '<ProtectedDialog variant="full" ariaLabel="The stage door" className={styles.stage}>', '<div className={`${styles.stage} host-protected`}>', ["src/ui/shell/library-gate-mount.test.tsx"]),
  { name: "theme mods: the Kit Gate is not a protected dialog", edits: [
    { file: "src/ui/agent/gate-card.tsx", find: '<ProtectedDialog variant="card" className="gate-card" role="alertdialog" labelledBy="gate-card__title" style={kitVars()}>', replace: '<section className="gate-card host-protected" role="alertdialog" aria-labelledby="gate-card__title">' },
    { file: "src/ui/agent/gate-card.tsx", find: "</ProtectedDialog>", replace: "</section>" },
  ], tests: ["src/ui/agent/gate-card.test.tsx"] },
  { name: "theme mods: the Security flows are not protected dialogs", edits: [
    { file: "src/ui/apps/settings/sections/security.tsx", find: '<ProtectedDialog variant="card" ariaLabel="Security">', replace: "<div>" },
    { file: "src/ui/apps/settings/sections/security.tsx", find: "</ProtectedDialog>", replace: "</div>" },
  ], tests: ["src/ui/apps/settings/sections/security-dialogs.test.tsx"] },
  one("protected surfaces are not zoomed back", TOKENS, "zoom: var(--host-type-zoom, 1) !important;", "", BROWSER),
  one("protected text inherits a smeared fill", TOKENS, "-webkit-text-fill-color:currentcolor; text-shadow:none; letter-spacing:normal; word-spacing:normal;", "", BROWSER),
  one("the type pin is never written", MOD, 'if (next === "") root.removeProperty(TYPE_PIN_PROPERTY); else root.setProperty(TYPE_PIN_PROPERTY, next);', 'if (next === "") root.removeProperty(TYPE_PIN_PROPERTY);', [...WATCH, ...BROWSER]),
  one("the type pin ignores a mod's zoom", MOD, "/ (zoomOf(document.documentElement) * zoomOf(document.body))", "", BROWSER),
  one("the type pin outlives the mod", MOD, "  document.documentElement.style.removeProperty(TYPE_PIN_PROPERTY);\n  stopWatching();", "  stopWatching();", WATCH),
  one("a page change does not rescan", MOD, "observer = new MutationObserver(rescan);", "observer = new MutationObserver(() => undefined);", WATCH),
  one("a resize does not rescan", MOD, 'const events = ["resize", "animationstart", "animationend", "transitionend"] as const;', 'const events = ["animationstart", "animationend", "transitionend"] as const;', WATCH),
  one("rescans are not spaced by the last scan's cost", MOD, "lastScanEnd + lastScanMs * RESCAN_DUTY - performance.now()", "0", WATCH),
  one("the watchers outlive the mod", MOD, "  unwatch?.();\n  unwatch = null;", "", WATCH),
  one("a top-layer surface is scanned for overlays", DOG, "if (inline.length === 0) return;", "", DOGTESTS),
  one("a small overlay over an inline surface is not seen", DOG, "else if (coversInline(el, box))", "else if (false)", [...DOGTESTS, ...BROWSER]),
  one("a host widget pushed onto the surface is blamed on the mod", DOG, " && !hostPositioned(o));", ");", DOGTESTS),
  one("an overlay painted under the surface is blamed", DOG, "return top !== null && probe.contains(el, top);", "return true;", DOGTESTS),
  one("hit points ignore what is clipped away", DOG, "const b = probe.visibleBox(surface);", "const b = probe.box(surface);", DOGTESTS),
];
