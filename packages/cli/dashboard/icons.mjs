// One emblem icon per visible achievement, keyed by the achievement id of src/achievements/catalog.mjs: a detailed 24 px
// line drawing plus the shape of its badge. The Achievements screen scales the drawing inside an 80 px frame, and the
// Overview strip draws the same framed emblem at badge size. Secret achievements are not here: their ids would name them
// to anyone reading the page's source. A found secret brings its own drawing in the model instead.
export const ACHIEVEMENT_ICONS = {
  // Milestones
  contributor: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.8a2.2 2.2 0 0 0 0 4.4H7M17 5.5h2.2a2.2 2.2 0 0 1 0 4.4H17"/><path d="M12 14v3M9.5 20h5M10 17h4"/><path d="M12 6.2l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z"/>',
  "merge-master": '<circle cx="12" cy="12" r="2.2"/><circle cx="4.5" cy="5.5" r="2"/><circle cx="19.5" cy="5.5" r="2"/><circle cx="4.5" cy="18.5" r="2"/><circle cx="19.5" cy="18.5" r="2"/><path d="m6.2 6.8 3.8 3.4M17.8 6.8 14 10.2M6.2 17.2 10 13.8M17.8 17.2 14 13.8"/>',
  hoarder: '<path d="M3.5 9.5h17v10h-17z"/><path d="M3.5 9.5c0-3.4 3.8-5.5 8.5-5.5s8.5 2.1 8.5 5.5"/><path d="M3.5 13h17"/><rect x="9.5" y="12" width="5" height="4.5" rx="1"/><path d="M12 13.5v1.5M6 16.5h1M17 16.5h1M6 11h1M17 11h1"/>',
  jackpot: '<path d="M6 8.5h3.4L7.7 15M10.8 8.5h3.4l-1.7 6.5M15.6 8.5H19l-1.7 6.5"/><path d="M12 17.2l.5 1.1 1.1.4-1.1.4-.5 1.1-.5-1.1-1.1-.4 1.1-.4z"/><circle cx="4.5" cy="12" r=".7" fill="currentColor"/><circle cx="19.5" cy="12" r=".7" fill="currentColor"/>',
  overdrive: '<path d="M13.5 2.5 5.5 13.5H11l-.5 8 8-11H13z"/><path d="M3.5 6.5h2M3 10.5h1.5M18.5 16.5h2M18 20.5h1.5"/><path d="M18 5.5 19.5 4M19.5 8.5H21"/>',
  // The kind of work
  builder: '<path d="m4 20 6.5-6.5"/><path d="M9.5 8 12 5.5 19.5 13 17 15.5z"/><path d="M16.5 3.5 18 2M19 6l1.5-.7M20.5 9.5h1.5"/>',
  "bug-hunter": '<path d="M9 7.5a3 3 0 0 1 6 0V9"/><path d="M8 9h8a2 2 0 0 1 2 2v2a6 6 0 0 1-12 0v-2a2 2 0 0 1 2-2z"/><path d="M12 11v8"/><path d="m8 7-2-2M16 7l2-2M3 11h5M16 11h5M3 16h5M16 16h5M6 21l2-2M18 21l-2-2"/><circle cx="10.5" cy="13" r=".55" fill="currentColor"/><circle cx="13.5" cy="13" r=".55" fill="currentColor"/>',
  architect: '<circle cx="12" cy="4" r="1.5"/><path d="M12 5.5V9M12 9 6 21M12 9l6 12M8 16h8"/><path d="m7.5 18.5 1.2 1M16.5 18.5l-1.2 1"/>',
  guardian: '<path d="M12 2.8 4.5 5.8v5.7c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V5.8z"/><path d="M12 7v7M8.5 10.5h7"/><path d="M4.5 3 2.5 4.5M19.5 3 21.5 4.5"/>',
  "speed-demon": '<path d="M3.5 18a8.5 8.5 0 1 1 17 0"/><path d="M12 18l4.8-4.8"/><circle cx="12" cy="18" r="1.3"/><path d="M6 12.5l1.2 1M18 12.5l-1.2 1M12 9.5V11M7.9 15.5l1.2.8M16.1 15.5l-1.2.8"/>',
  scribe: '<path d="M20.5 3.5c-7.5 1.2-11.7 5.1-13.2 10.7l2.5 2.5C15.4 15.2 19.3 11 20.5 3.5z"/><path d="M4 20c2.2-4.6 5.3-8 9.5-10.5"/><path d="m13.8 13.2 2.2 2.2"/><circle cx="5" cy="16.5" r=".7" fill="currentColor"/><circle cx="3.8" cy="19" r=".5" fill="currentColor"/>',
  "test-pilot": '<path d="M9 2.5h6M10 2.5v6L5.2 17a2 2 0 0 0 1.8 3h10a2 2 0 0 0 1.8-3L14 8.5v-6"/><path d="M7.2 14h9.6"/><path d="m10.3 17.2 1.5 1.5 2.9-3.2"/><circle cx="16.8" cy="11" r="1"/><circle cx="18.8" cy="8.2" r=".6"/><circle cx="14.8" cy="10" r=".5"/>',
  plumber: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-8 8l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 8-8l-3.8 3.8z"/><path d="M4.5 11.5c0-1.3 1.5-3.2 1.5-3.2s1.5 1.9 1.5 3.2a1.5 1.5 0 0 1-3 0z"/>',
  exterminator: '<rect x="7" y="9" width="8" height="12" rx="2"/><path d="M9 9V6h4v3"/><path d="M13 6h3.5v3H13"/><path d="M19.5 3.5l1-1M21 7h1.5M19.5 10.5l1 1"/><path d="M9 13h4M9 16h4"/>',
  // Quality
  craftsman: '<path d="m7 3.5-4.5 6L12 21l9.5-11.5-4.5-6z"/><path d="M2.5 9.5h19M8.5 3.5 12 9.5l3.5-6M12 9.5V21"/><path d="M19.5 2.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5zM4.5 18.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
  perfectionist: '<path d="m4 17.5 1-9 4.5 3L12 5l2.5 6.5 4.5-3 1 9z"/><path d="M4 20.5h16"/><circle cx="12" cy="14.5" r=".8" fill="currentColor"/><circle cx="8" cy="13.5" r=".6" fill="currentColor"/><circle cx="16" cy="13.5" r=".6" fill="currentColor"/>',
  "hard-mode": '<path d="m2.5 20 6.5-11 3.8 6.3L16 11l5.5 9z"/><path d="m7.5 12.5 1.5 1 1.5-1"/><path d="M16 10.5V5.5l3 1.5-3 1.5"/>',
  "on-target": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  "tiny-but-mighty": '<path d="m12 8.5 3.5 3.5-3.5 3.5L8.5 12z"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
  janitor: '<path d="m16.5 2.5-6 11"/><path d="M6.5 12.5h8l2 9h-12z"/><path d="M8.5 15.5v6M12.5 15v6"/><circle cx="19" cy="14" r=".7" fill="currentColor"/><circle cx="21" cy="17" r=".5" fill="currentColor"/><circle cx="18" cy="19" r=".5" fill="currentColor"/>',
  "test-believer": '<path d="M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1M9 14h2M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2zM12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/><circle cx="18.5" cy="5" r=".8" fill="currentColor"/><circle cx="20.5" cy="8" r=".5" fill="currentColor"/>',
  "green-light": '<rect x="6.5" y="2.5" width="11" height="19" rx="3.5"/><circle cx="12" cy="7.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="16.5" r="1.4" fill="currentColor"/><path d="M9 20.5h6"/>',
  "core-contributor": '<circle cx="12" cy="12" r="1.8" fill="currentColor"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(120 12 12)"/><circle cx="4.5" cy="8.5" r=".8" fill="currentColor"/><circle cx="19.5" cy="15.5" r=".8" fill="currentColor"/><circle cx="15" cy="4.5" r=".7" fill="currentColor"/>',
  // Rhythm
  streak: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/><path d="M12 12.5c.8 1.1.6 2.5-.3 3.4-.9.9-2.3.8-3-.3-.8-1.2-.4-2.7.7-4.2"/><path d="M5.5 5.5 4.5 4.5M18.5 5.5l1-1"/>',
  "hat-trick": '<path d="M9 18V6h6v12"/><path d="M5.5 18c0-1.4 2.9-2.5 6.5-2.5s6.5 1.1 6.5 2.5-2.9 2.5-6.5 2.5-6.5-1.1-6.5-2.5z"/><path d="M9 14h6"/><path d="m12 8 .7 1.4 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/>',
  "full-week": '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 2.5V6M16 2.5V6"/><path d="m8.5 15 2.5 2.5 4.5-4.5"/>',
  "night-owl": '<path d="M20.5 14.8A8.7 8.7 0 0 1 9.2 3.5a8.8 8.8 0 1 0 11.3 11.3z"/><path d="m17.5 3 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/><path d="m6 6 .4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4z"/><circle cx="13" cy="10" r="1"/><circle cx="10.5" cy="15" r=".7"/>',
  "early-bird": '<path d="M3 19.5h18M5.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M12 2.5v4M4.8 6.3l2.2 2.2M19.2 6.3l-2.2 2.2"/><path d="M16 9.5c.7-.7 1.4-.7 2.1 0M18.1 9.5c.7-.7 1.4-.7 2.1 0"/>',
  "weekend-warrior": '<path d="M3 3 16.5 14.5 15 16zM21 3 7.5 14.5 9 16z" fill="currentColor" stroke="none"/><path d="m13.8 17.2 3.4-3.4M6.8 17.2l3.4-3.4"/><path d="m16 16 3 3M8 16l-3 3"/><circle cx="20" cy="20" r=".9" fill="currentColor"/><circle cx="4" cy="20" r=".9" fill="currentColor"/>',
  // Range and habits
  explorer: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2"/>',
  polyglot: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M7 7.5h10M7 16.5h10"/><path d="M12 3.5c2.5 2.3 3.8 5.1 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.1-3.8-8.5S9.5 5.8 12 3.5z"/>',
  "by-the-book": '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H20"/><path d="M9 3v7l2-1.5 2 1.5V3"/><path d="M14.5 8h3M14.5 11h3M8 15h9"/>',
  "co-pilot": '<circle cx="9" cy="8" r="2.8"/><path d="M3.5 19c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><path d="M15.5 5.6a2.8 2.8 0 0 1 0 5.2M17 13.8c2.1.5 3.5 2.3 3.5 4.4"/><path d="M6.2 8a2.8 2.8 0 0 1 5.6 0M5.5 8.5v2M12.5 8.5v2"/>',
};

// The frame each achievement wears on its card. The shape is part of the achievement's identity, as in a game's badge
// wall; all of them sit on the same 80 px grid as the drawing inside. A drawing that already fills its own silhouette
// (a shield, a round gauge, a target) wears no frame: behind it a frame would only double the outline.
const FRAMES = {
  contributor: "shield", "merge-master": "circle", hoarder: "square", jackpot: "star", overdrive: "hex",
  builder: "circle", "bug-hunter": "hex", architect: "circle", guardian: "none", "speed-demon": "none",
  scribe: "circle", "test-pilot": "hex", plumber: "circle", exterminator: "circle", craftsman: "shield",
  perfectionist: "none", "hard-mode": "diamond", "on-target": "none", "tiny-but-mighty": "none", janitor: "hex",
  "test-believer": "circle", "green-light": "square", "core-contributor": "none", streak: "shield",
  "hat-trick": "square", "full-week": "none", "night-owl": "none", "early-bird": "circle", "weekend-warrior": "shield",
  explorer: "none", polyglot: "hex", "by-the-book": "none", "co-pilot": "circle",
};

const FRAME_ART = {
  circle: '<circle class="emblem-frame" cx="40" cy="40" r="35"/><circle class="emblem-inner" cx="40" cy="40" r="29"/>',
  shield: '<path class="emblem-frame" d="M40 3 71 15v24c0 18-13 32-31 38C22 71 9 57 9 39V15Z"/><path class="emblem-inner" d="M40 10 64 19v20c0 14-10 25-24 30C26 64 16 53 16 39V19Z"/>',
  hex: '<path class="emblem-frame" d="M40 3 71 21v38L40 77 9 59V21Z"/><path class="emblem-inner" d="M40 10 64 25v30L40 70 16 55V25Z"/>',
  square: '<rect class="emblem-frame" x="5" y="5" width="70" height="70" rx="16"/><rect class="emblem-inner" x="11" y="11" width="58" height="58" rx="11"/>',
  star: '<path class="emblem-frame" d="M40 2 48 22 68 13 59 33 79 40 59 47 68 67 48 58 40 78 32 58 12 67 21 47 1 40 21 33 12 13 32 22Z"/><path class="emblem-inner" d="M40 12 45 26 59 20 53 34 67 40 53 46 59 60 45 54 40 68 35 54 21 60 27 46 13 40 27 34 21 20 35 26Z"/>',
  diamond: '<path class="emblem-frame" d="M40 3 77 40 40 77 3 40Z"/><path class="emblem-inner" d="M40 12 68 40 40 68 12 40Z"/>',
  none: "",
};

const DASHED = new Set(["bug-hunter"]);
const STAR = '<path d="m12 3 2.5 5.5 6 .8-4.4 4.2 1.1 6-5.2-2.9-5.2 2.9 1.1-6L3.5 9.3l6-.8z"/>';

// The glyph layer of an emblem: the drawing centered on the 80 px grid. A framed drawing keeps the frame's inner scale;
// a frameless one grows to the footprint a frame would have given it.
const glyph = (scale) => {
  const inset = (80 - 24 * scale) / 2;
  return `<g class="emblem-glyph" transform="translate(${inset} ${inset}) scale(${scale})">`;
};

function emblem(drawing, frame, dashed = "") {
  return `<svg class="emblem-art${dashed}" data-frame="${frame}" viewBox="0 0 80 80" fill="none" aria-hidden="true">`
    + FRAME_ART[frame]
    + glyph(frame === "none" ? 2.5 : 2)
    + drawing + "</g></svg>";
}

// The drawing inside its frame, for the large badge of an achievement card.
export function achievementEmblem(id) {
  const drawing = ACHIEVEMENT_ICONS[id];
  return drawing ? emblem(drawing, FRAMES[id] ?? "circle", DASHED.has(id) ? " dashed" : "") : "";
}

// A secret wears no frame either: its own drawing comes from the model once it is found. The plain star is the fallback
// for a model written before secret drawings existed.
export const secretEmblem = (drawing = "") => emblem(drawing || STAR, "none");

