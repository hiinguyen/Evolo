// The Evolo mark: angle brackets around a commit node on the amber tile. The brackets say code, the node is the unit
// Evolo scores, and the gradient is the one the badges already use. One drawing serves the sidebar brand and the page's
// favicon, so the two can never drift; `src/dashboard.mjs` turns it into the data URL and app.mjs puts it in the frame.
export const BRAND_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<defs><linearGradient id="evolo-brand" x1="3" y1="1" x2="29" y2="31" gradientUnits="userSpaceOnUse">'
  + '<stop offset="0" stop-color="#ffb020"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient></defs>'
  + '<rect width="32" height="32" rx="9" fill="url(#evolo-brand)"/>'
  + '<path d="M11.2 9.6 5.8 16l5.4 6.4" fill="none" stroke="#fff7ed" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M20.8 9.6 26.2 16l-5.4 6.4" fill="none" stroke="#fff7ed" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="16" cy="16" r="2.8" fill="#fff7ed"/>'
  + "</svg>";
