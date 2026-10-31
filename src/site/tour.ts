/**
 * The feature tour: the cast (one entry per part of Bunzai) and the page each one gets. Every line
 * here describes shipped behavior as docs/reference/ui.md and docs/guide/ record it; when the app
 * changes, this copy changes with it. Screenshots are the real ones in docs/media.
 */
type Shot = readonly [file: string, caption: string, copy?: { readonly title: string; readonly intro: string }];

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly color: string;
  readonly card: string;
  readonly title: string;
  readonly intro: string;
  readonly points: readonly (readonly [string, string])[];
  readonly shots: readonly Shot[];
  /** Number of these screenshots included in the auditorium tour. */
  readonly galleryShots?: number;
  readonly guides: readonly (readonly [string, string])[];
  readonly note?: string;
  /** True when the browser Studio has it too (docs/reference/ui.md, Browser Studio). */
  readonly browser: boolean;
}

export const CAST: readonly Member[] = [
  {
    id: "scenes", browser: false, name: "Scenes", role: "play", color: "pink", galleryShots: 2,
    card: "Play out a story with any character. Branch it, rewind it, keep every take.",
    title: "Play a scene with any character.",
    intro: "Start a scene from a character in your Library and talk. Replies come from your own AI connection and write themselves in as they arrive.",
    points: [
      ["Start from any card", "Start Scene sits under every character in the Library. The scene keeps its own copy, so editing the card later never rewrites your story."],
      ["Takes and branches", "Branch from any message into a new take. Name your takes, switch between them, and the original stays put."],
      ["Stop, regenerate, flip", "Stop a reply mid-sentence and keep what arrived, or regenerate and step through the versions with the arrow keys."],
      ["Your model, your preset", "Pick a connection and model for each scene, and a preset from your library, with switches and sliders tuned just for this scene."],
      ["Card updates, on your terms", "When a character gets a newer version, the scene offers it, and can go back to the old one."],
      ["Nothing lost by accident", "Deleted scenes wait in the Trash for 3 days, and cut messages for 1 day."],
    ],
    shots: [
      ["shot-scenes.png", "The Scenes page: your stories and recent takes", { title: "Find the story you want to return to.", intro: "Scenes brings your stories together, with character artwork, recent activity and a Continue action. Browse your collection, switch between pictures and a list, or pick up where you left off." }],
      ["shot-scene-chat.png", "Inside a scene: Your Personal Knight's opening message", { title: "Step into the conversation.", intro: "A character's opening sets the scene. Write your next line, choose your AI connection and let the story unfold. The pictured scene shows its opening message before a model is connected." }],
    ],
    guides: [],
    note: "Scenes need the installed app and an AI connection. The browser version cannot play them yet.",
  },
  {
    id: "workbench", browser: true, name: "The Workbench", role: "make", color: "peach", galleryShots: 3,
    card: "Build characters, lorebooks, personas, presets and more, each with its own editor.",
    title: "Where every piece gets made.",
    intro: "Send a piece to the Workbench and it opens in the editor made for its kind: character, lorebook, persona, regex set, preset, or pack.",
    points: [
      ["Characters, two ways", "Edit in the Grid, with every field at once, or walk through it in Steps. Your draft saves when you say so."],
      ["Lorebooks", "Add entries, give each the keywords that wake it up, and decide where it lands in the prompt."],
      ["Personas", "Build who you are in a scene from identity and sections, or plain text, and choose where it goes."],
      ["Regex sets", "Write find-and-replace rules, set where and in what order they run, and check what a rule does before you save it."],
      ["Presets", "The full preset editor: every prompt, its order, and its samplers."],
    ],
    shots: [["shot-workbench.png", "A character on the Workbench"], ["shot-lorebook.png", "Editing Aridia's world knowledge", { title: "Build the world behind the dialogue.", intro: "Edit a lorebook's entries, keywords and placement. Keep locations, factions and character knowledge in focused pieces that your scenes can draw on." }], ["shot-preset.png", "Editing a writing preset", { title: "Shape how the story is written.", intro: "Arrange the prompt, edit its instructions and tune generation settings in the preset editor. Reuse a writing setup across scenes instead of rebuilding it each time." }], ["shot-persona.png", "A persona"]],
    guides: [["editing", "Edit a piece"], ["lorebooks", "Build a lorebook"], ["personas", "Create and manage personas"], ["regex", "Edit a regex set"]],
  },
  {
    id: "library", browser: true, name: "The Library", role: "keep", color: "butter", galleryShots: 2,
    card: "Every character, lorebook and persona you own, in one tidy place.",
    title: "Everything you own, on the shelves.",
    intro: "The Library is the browse room: decks for each kind of piece, with live counts, in rows or a grid. It is also the door your files come in through.",
    points: [
      ["Drop a file in", "Drag a card, lorebook, persona, or regex set onto the Library, or click Import."],
      ["A receipt before anything is saved", "Bunzai reads every file first and shows what it found. Uncheck what you do not want; only what is still checked gets saved."],
      ["Plain reasons", "A file it cannot read says why, in plain words, instead of failing quietly."],
      ["Send anywhere", "Stage one piece or many and send them to the Workbench or the Press together."],
      ["Kept private", "Your library lives on your computer, encrypted, in your Documents folder."],
    ],
    shots: [["shot-library.png", "Characters in the RoleCall Library"], ["shot-library-lorebooks.png", "Lorebook covers with aligned titles and metadata", { title: "Give your worlds a place to live.", intro: "Lorebooks hold the places, people and rules behind a story. Browse your books by cover, see their entry counts, then open one to edit the knowledge your scenes draw on." }], ["shot-import-drop.png", "Dropping a file in"]],
    guides: [["getting-started", "Get started"], ["importing", "Import a file"], ["library", "Browse the Library"]],
  },
  {
    id: "press", browser: true, name: "The Press", role: "share", color: "mint",
    card: "Send your work out in the format another app reads, and see what travels first.",
    title: "Send your work anywhere.",
    intro: "Stage the pieces you want to send, pick the app they are going to, and the Press makes the files.",
    points: [
      ["Stage, pick, print", "Right-click any piece and choose Stage for the Press. Pick one target, run the press, download the bundle."],
      ["Nothing left behind", "A character's lorebooks and a preset's regex sets ride along, and you can drop any of them from the run."],
      ["Honest about what drops", "Before anything downloads, the Press shows exactly what the other app cannot hold."],
      ["Knows the neighbors", "SillyTavern, RisuAI, Chub, Backyard, Agnai, NovelAI, Pygmalion, Marinara, Lumiverse and RoleCall each have a guide."],
    ],
    shots: [["shot-press.png", "The Press"], ["shot-export-honesty.png", "What will drop, before it does"], ["shot-convert.png", "Converting a card"]],
    guides: [["exporting", "Export a piece"], ["converting", "Convert a card"], ["platforms", "Notes for other apps"]],
  },
  {
    id: "promptbooks", browser: true, name: "Promptbooks", role: "direct", color: "sky", galleryShots: 0,
    card: "Give your story a workflow of its own.",
    title: "Plan the scene. Write it. Keep the thread.",
    intro: "A Promptbook organizes instructions into phases. The Midnight Express example reads the situation, plans clues and character intentions, checks the alibi, writes the scene, then records continuity and open threads.",
    points: [["Reusable phases", "Keep instructions and hand-offs together in one library piece."], ["Two board levels", "See the whole workflow or the prompt blocks inside a phase."], ["Check before playing", "Rehearse phase conditions without making a model call."]],
    shots: [["shot-promptbook-nodes.png", "The Midnight Express: planning, story and continuity phases"], ["shot-promptbook-blocks.png", "Inside a Promptbook phase: its ordered prompt blocks", { title: "Direct the details of each phase.", intro: "Each phase has its own prompt stack. Arrange instructions and context blocks, switch them on or off, and control what the model receives for that step of the story." }]],
    guides: [],
    note: "Playing a Promptbook needs the installed app and an AI connection. The pictured example uses the scene's model; no model calls were made for these captures.",
  },
  {
    id: "themes", browser: true, name: "Themes", role: "dress", color: "lilac", galleryShots: 1,
    card: "One studio. A different atmosphere.",
    title: "Make the studio feel like yours.",
    intro: "Change the studio's palette, typography and supported layouts. These are real captures of the same library in RoleCall, Theater and Paper.",
    points: [["Four bundled looks", "Switch themes in Settings, then keep working with the same pieces."], ["Your accent", "Choose a color for your studio."], ["Motion choices", "Keep stage lights moving, make them still, or turn them off."]],
    shots: [
      ["shot-theme-paper.png", "Paper: light pages and a catalog layout", { title: "Paper. A lighter place to work.", intro: "Warm paper tones, serif lettering and a catalog layout give the Library a quieter feel. Switch themes in Settings without moving or recreating your collection." }],
      ["shot-theme-rolecall.png", "RoleCall: dark surfaces and colored deck accents", { title: "RoleCall. The dark studio.", intro: "Dark panels, crisp borders and colored deck accents keep the focus on your collection. This is the RoleCall Library with the same characters used throughout this tour." }],
      ["shot-theme-theater.png", "Theater: an art-forward Library", { title: "Theater. Put your cast on display.", intro: "The Theater theme gives artwork a leading role, with a dark backdrop and a Library layout built around your cast. Your pieces stay the same as you change the atmosphere." }],
    ],
    guides: [],
  },
  {
    id: "agent", browser: false, name: "The Agent", role: "help", color: "sky",
    card: "A helper that can see the screen you are on and do the fiddly parts with you.",
    title: "A helper that sees what you see.",
    intro: "The Agent is a conversation with your own AI model that knows which screen you are on and can use Bunzai's real tools.",
    points: [
      ["It sees the screen", "Each room tells the Agent what it is for and what is on it right now, so you can just say \"fix this one\"."],
      ["Real tools, not advice", "It can read and change your pieces with the same tools the app uses."],
      ["Nothing changes without you", "When it wants to write something, a card takes over the bottom of the window and it waits there until you answer."],
      ["Your model", "It uses whichever AI connection you have set up. No account with us."],
    ],
    shots: [],
    guides: [],
    note: "The Agent needs the installed app and an AI connection.",
  },
  {
    id: "kit", browser: false, name: "Kit", role: "terminal", color: "lilac",
    card: "Your whole studio as a conversation, in a terminal. Optional.",
    title: "Your studio, in a terminal.",
    intro: "Kit is the terminal companion: the same library and the same tools, as a conversation you type into. It is a separate, optional download.",
    points: [
      ["Same studio", "Kit works on the same library as the app, with the same key vault and the same approvals."],
      ["Where it runs", "Windows x64, Linux x64, Linux arm64, and Apple Silicon Macs."],
      ["Optional", "You never need Kit to use Bunzai. It is there if you like working in a terminal."],
    ],
    shots: [],
    guides: [],
  },
];

const point = ([title, text]: readonly [string, string]): string => `<li><b>${title}.</b> ${text}</li>`;
const shot = ([file, caption]: Shot, media: string): string =>
  `<figure class="shot"><img src="${media}${file}" alt="${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`;

/** A small drawn stand-in for rooms the docs have no screenshot of. */
function sketch(m: Member): string {
  if (m.id === "scenes") return SCENE_WINDOW;
  const line = m.id === "agent"
    ? ["The Agent", "This lorebook has three entries with no keywords. Want me to suggest some?", "Add keywords to 3 entries?"]
    : ["Kit", "Your library has 12 characters and 3 lorebooks. What are we making?", "Write persona \"Night Shift\"?"];
  return `<div class="win"><div class="bar"><i></i><i></i><i></i><span style="margin-left:8px">${line[0]!.toUpperCase()}</span></div>
<div class="msg" style="--c:var(--${m.color})"><div class="av"></div><div><b>${line[0]}</b><p>${line[1]}</p></div></div>
<div class="note" style="--c:var(--${m.color});margin:0 20px 20px">${line[2]} <b>Yes</b> or <b>Not now</b></div></div>`;
}

export const SCENE_WINDOW = `<div class="win scene-example" data-scene-example>
<div class="bar"><span class="scene-room">SCENES</span><span>THE LIGHTHOUSE &middot; TAKE 2</span><span class="example-label">EXAMPLE CONVERSATION</span></div>
<div class="scene-toolbar"><span>Midnight. The lighthouse.</span><button type="button" data-reading-mode aria-pressed="false">Manuscript view</button></div>
<div class="scene-transcript" role="log" aria-label="Example conversation" aria-live="polite">
<div class="msg" style="--c:var(--pink)"><div class="av" aria-hidden="true">V</div><div><b>Vera</b><p>You came up the stairs without a lantern. Brave, or a little foolish?</p></div></div>
<div class="msg you" style="--c:var(--sky)"><div class="av" aria-hidden="true">Y</div><div><b>You</b><p>A little of both.</p></div></div>
<div class="msg" style="--c:var(--pink)"><div class="av" aria-hidden="true">V</div><div><b>Vera</b><p>Then sit. The storm holds till midnight, and I have tea.</p></div></div></div>
<form class="scene-composer"><input name="line" maxlength="600" aria-label="Your line in the example conversation" placeholder="Write your next line…" autocomplete="off"><button class="btn" type="submit">Continue example <span aria-hidden="true">&#8599;</span></button></form>
<div class="example-foot"><span>A scripted preview. No AI connection needed.</span><button type="button" data-scene-reset>Reset</button></div></div>`;

/** One picture of a member for the home page's reel: its first screenshot, or the drawn stand-in. */
export function visual(m: Member): string {
  const first = m.shots[0];
  return first ? `<img src="media/${first[0]}" alt="${first[1]}" loading="lazy">` : sketch(m);
}

/** The body of one tour page (the frame is added by the caller). */
export function tourBody(m: Member): string {
  const i = CAST.indexOf(m);
  const prev = CAST[i - 1], next = CAST[i + 1];
  const visuals = m.shots.length > 0 ? m.shots.map((s) => shot(s, "../media/")).join("") : sketch(m);
  const guides = m.guides.length > 0
    ? `<div class="act" style="margin-top:36px"><b>Read more</b></div><div class="grid-links">${m.guides.map(([slug, title]) => `<a href="../guides/${slug}.html"><div><h3>${title}</h3></div><span>&rarr;</span></a>`).join("")}</div>`
    : "";
  return `<div class="wrap page" style="--c:var(--${m.color})">
<a class="crumb" href="../index.html#tour">&larr; The cast</a>
<div class="role" style="max-width:420px">${m.name}<i></i>${m.role}</div>
<h1>${m.title}</h1><p class="lede">${m.intro}</p>
<div class="split"><div><ul class="points">${m.points.map(point).join("")}</ul>${m.note ? `<p class="note">${m.note}</p>` : ""}</div><div>${visuals}</div></div>
${guides}
<nav class="pager" aria-label="Tour">${prev ? `<a href="${prev.id}.html">&larr; ${prev.name}</a>` : "<span></span>"}${next ? `<a href="${next.id}.html">${next.name} &rarr;</a>` : `<a href="../download.html">Get Bunzai &rarr;</a>`}</nav>
</div>`;
}
