// One drawing per secret achievement, in the 24 px language of dashboard/icons.mjs: a found secret wears its own
// glyph without a frame, while a secret still hidden is only a count.
// This module is read on the Node side when the dashboard model is built, never bundled into the page: only the
// drawings of secrets that have been found travel in the model, so a locked secret leaves no id or art in the page.
export const SECRET_ICONS = {
  // Rewritten history
  "ctrl-z": '<path d="M8 4.5 3.5 9 8 13.5"/><path d="M3.5 9h9.5a6 6 0 0 1 0 12H8"/><path d="M8.5 17.5h4.5"/>',
  revisionist: '<path d="M5.5 6.5A8 8 0 1 1 4 12"/><path d="M5.5 2.5v4h4"/><path d="M9.5 9h5v6h-5z"/><path d="M11 11h2M11 13h2"/>',
  // Calendar and clock
  "yolo-friday": '<path d="M4 4.5h16l-8 8z"/><path d="M12 12.5V19M8.5 21h7"/><circle cx="15" cy="6.5" r="1"/><path d="m18 2 .5 1.2 1.2.5-1.2.5L18 5.4l-.5-1.2-1.2-.5 1.2-.5z"/>',
  "friday-13": '<path d="M6.5 20.5v-4.6c0-2.4 1.5-4.5 3.7-5.3l.3-3.1 2.2 2.1h.6l2.2-2.1.3 3.1c2.2.8 3.7 2.9 3.7 5.3v4.6"/><path d="M6.5 20.5c-2.3.1-3.8-1.1-3.8-2.8 0-1.1.7-2 1.7-2.3"/><circle cx="9.8" cy="13.2" r=".75" fill="currentColor"/><circle cx="14.2" cy="13.2" r=".75" fill="currentColor"/><path d="M10 16.5h4M11 16.5v1M13 16.5v1M16.5 4.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  "three-am": '<circle cx="12" cy="12.5" r="7"/><path d="M12 12.5v-5M12 12.5h4"/><path d="M12 2.5v1.5M12 21v1.5M2.5 12.5H4M20 12.5h1.5"/><path d="m18.5 3.5.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5zM5.5 3l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
  "new-year": '<path d="M3.5 3.5h5.5l-.6 7a3 3 0 0 1-4.3 0z"/><path d="M6.25 13.5V20M3.5 20.5h5.5"/><path d="M15 3.5h5.5l-.6 7a3 3 0 0 1-4.3 0z"/><path d="M17.75 13.5V20M15 20.5h5.5"/><circle cx="10.5" cy="6" r=".6" fill="currentColor"/><circle cx="13.5" cy="9" r=".5" fill="currentColor"/><path d="m12 1 .5 1.2 1.2.5-1.2.5L12 4.4l-.5-1.2-1.2-.5 1.2-.5z"/>',
  christmas: '<path d="M12 4.5 8 9h2.5L6.5 14H9L5 19.5h14L15 14h2.5L13.5 9H16z"/><path d="M10.5 19.5V22h3v-2.5"/><path d="m12 1 .6 1.4 1.4.6-1.4.6L12 5l-.6-1.4L10 3l1.4-.6z"/><circle cx="10" cy="12" r=".7" fill="currentColor"/><circle cx="14.5" cy="13.5" r=".7" fill="currentColor"/><circle cx="9" cy="16.5" r=".7" fill="currentColor"/><circle cx="15" cy="17" r=".7" fill="currentColor"/>',
  // Scale and history
  "thanos-snap": '<path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17" stroke-dasharray="2 3"/><circle cx="16.5" cy="7" r=".8" fill="currentColor"/><circle cx="19" cy="10.5" r=".6" fill="currentColor"/><circle cx="17" cy="14" r=".9" fill="currentColor"/><circle cx="15" cy="17.5" r=".5" fill="currentColor"/><circle cx="20.5" cy="16" r=".5" fill="currentColor"/>',
  monolith: '<path d="M9.5 2.8 15 3.5 14 20.5H8z"/><path d="M9.5 2.8 8 20.5M15 3.5l-1 17"/><path d="M4 20.5h16"/><circle cx="4.5" cy="7" r=".6" fill="currentColor"/><circle cx="19" cy="6" r=".8" fill="currentColor"/><circle cx="17" cy="11" r=".5" fill="currentColor"/><circle cx="5.5" cy="15" r=".5" fill="currentColor"/>',
  leet: '<path d="M4 19v-8l3.5 2.2V7.5L12 12l4.5-4.5v5.7L20 11v8z" fill="currentColor" stroke="none"/><rect x="2.5" y="20.5" width="1.2" height="1.2" fill="currentColor" stroke="none"/><rect x="20.5" y="20.5" width="1.2" height="1.2" fill="currentColor" stroke="none"/>',
  "the-answer": '<circle cx="11.5" cy="12" r="5"/><ellipse cx="12" cy="13" rx="9.5" ry="3.2" transform="rotate(-20 12 13)"/><circle cx="9.8" cy="10.5" r=".7" fill="currentColor"/><path d="m19 3.5.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  comeback: '<path d="M3.5 20h17"/><path d="M7 20a5 5 0 0 1 10 0"/><path d="M12 15V8"/><path d="M9 11l3-3 3 3"/><path d="M5 7.5 3.5 6M19 7.5 20.5 6M12 4.5V3"/>',
  // Commit messages
  "very-descriptive": '<path d="M20 4.5H4v12h4v4l4.5-4H20z"/><circle cx="9" cy="10.5" r=".8" fill="currentColor"/><circle cx="12" cy="10.5" r=".8" fill="currentColor"/><circle cx="15" cy="10.5" r=".8" fill="currentColor"/>',
  novelist: '<path d="M4 5.5c2.7-1.6 5.3-1.6 8 0 2.7-1.6 5.3-1.6 8 0v12.5c-2.7-1.6-5.3-1.6-8 0-2.7-1.6-5.3-1.6-8 0z"/><path d="M12 5.5v12.5M6.5 9.5h3M6.5 12.5h3M14.5 9.5h3M14.5 12.5h3"/><path d="m18.5 2 .5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  "typo-lord": '<rect x="5" y="12" width="14" height="9" rx="2"/><path d="M7 10V5l3 2 2-3 2 3 3-2v5z"/><path d="M9 16.5h6"/><path d="m19 3 .4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
  // Numbers and scale
  "for-nothing": '<path d="M5 12h14v8H5z"/><path d="M5 12l2-7h10l2 7"/><path d="M5 15h14"/><path d="m12 6.5.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z"/>',
  "big-spender": '<path d="M9 7.5 7.5 4h9L15 7.5"/><path d="M8 7.5h8c2.5 2 4 5 4 8.5 0 3-2 5-6 5h-4c-4 0-6-2-6-5 0-3.5 1.5-6.5 4-8.5z"/><circle cx="19" cy="6" r="1.8"/><circle cx="16" cy="3.5" r="1.2"/>',
  meta: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><rect x="7" y="7" width="10" height="10" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
  halloween: '<ellipse cx="12" cy="13" rx="7.5" ry="6.5"/><path d="M12 6.5v13M8.2 7.2c-1.2 1.7-1.2 10 0 11.6M15.8 7.2c1.2 1.7 1.2 10 0 11.6"/><path d="M10.5 6.5c0-2 1-3 2.5-3s2 1 1.5 3"/><path d="m8.5 11 1.5 2.5H7z" fill="currentColor" stroke="none"/><path d="m15.5 11-1.5 2.5H17z" fill="currentColor" stroke="none"/><path d="M8 16h2l1-1 1 1h2l1-1 1 1"/>',
  "pi-day": '<path d="M11 13V5.5a7.5 7.5 0 1 0 7.5 7.5z"/><circle cx="8.5" cy="11" r="1.1"/><path d="M15 7.5 16.5 4l4.5 1.5-2 4z"/><path d="M16.5 4l-1 4.5"/>',
  valentine: '<path d="M12 20.5S3.5 15 3.5 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2.5c0 5.5-8.5 11-8.5 11z"/><path d="M7 11h3l1.5 2 2-3 1.5 1h2"/><circle cx="7" cy="11" r=".7" fill="currentColor"/><circle cx="17" cy="11" r=".7" fill="currentColor"/>',
  cinderella: '<path d="M4 19.5h9.5c2.5 0 4.5-1 6-2.5l1.5-1.5-2-.8-4 .4-2-3-3 3.4-6 1z"/><path d="M16.5 16v3.5"/><path d="m18 3 .5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5zM20.5 8l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"/>',
  century: '<circle cx="12" cy="10" r="5.5"/><path d="M8.5 14.5 7 21l5-2 5 2-1.5-6.5"/><path d="m12 6.8.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z"/>',
  speedrun: '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 13.5V10M12 13.5l2.5 1.5"/><path d="M10 2.5h4M12 2.5V5M18.5 6.5l1.5-1.5M5.5 6.5 4 5"/><path d="M2.5 12h2M2.5 16h2M20 12h1.5M20 16h1.5"/>',
  "prompt-engineer": '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3.5V7M9.5 12h.01M14.5 12h.01M9 15.5h6M5 11H3.5M19 11h1.5"/><circle cx="12" cy="2.5" r="1"/><path d="m18.5 3 .5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  // Style and shipping
  emoji: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c.9 1.3 2 2 3.5 2s2.6-.7 3.5-2"/><path d="M8 9.8h2.5"/><circle cx="15" cy="9.8" r=".8" fill="currentColor"/><path d="m19 2.5.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/>',
  "caps-lock": '<path d="M4 10v4h4l7 4V6l-7 4z"/><path d="M8 14l1.2 5h3L11 15"/><path d="M18 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12"/>',
  "undo-the-undo": '<path d="M4.5 8.5A8 8 0 0 1 19 11"/><path d="M4.5 4.5v4h4"/><path d="M19.5 15.5A8 8 0 0 1 5 13"/><path d="M19.5 19.5v-4h-4"/>',
  shipper: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/><path d="M7.5 5.5 16 9.5v3"/><path d="M7 13.5h3v3H7z"/>',
  "to-production": '<path d="M6 16.5h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5-1A4 4 0 0 0 6 16.5z"/><path d="M12 21.5v-8M9 16.5l3-3 3 3"/>',
  "one-point-oh": '<path d="M7 3.5h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4.5a2 2 0 0 0 0 4H7M17 5h2.5a2 2 0 0 1 0 4H17"/><path d="M12 13.5V17M9 21h6M9.5 17h5"/><path d="m12 5.5.7 1.4 1.5.2-1.1 1.1.3 1.5-1.4-.8-1.4.8.3-1.5-1.1-1.1 1.5-.2z"/>',
};

// The drawing of a secret, or "" for an id with none (the page then keeps the plain star).
export const secretIcon = (id) => SECRET_ICONS[id] ?? "";
