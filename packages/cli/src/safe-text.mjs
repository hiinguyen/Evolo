// Text from the judge or the repository (reasons, summaries, review prose, commit subjects, PR titles), made safe for
// where Evolo shows it: the terminal, and the body of a desktop notification.

// C0 controls but tab and newline, DEL, C1 controls, and the bidi embedding, override and isolate characters.
const UNSAFE_FOR_TERMINAL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

// Without its control characters, an escape sequence cannot clear the screen, retitle the terminal, or hide text
// behind a carriage return or a bidi override. Applied when printing, so records saved earlier are covered too.
export const terminalSafe = (text) => String(text).replace(UNSAFE_FOR_TERMINAL, "");

const MARKUP_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
export const escapeMarkup = (text) => text.replace(/[&<>]/g, (char) => MARKUP_ESCAPES[char]);

// The only markup kept: bold, italic, underline, and links to http(s) addresses, written exactly like this.
// Images are not among them: a notification would load one from anywhere as soon as it is shown.
const KEPT_TAG = /<(\/?)([biu])>|<a href=(["'])(https?:\/\/[^\s"'<>]+)\3>|<\/a>/g;

// `text` for the body of a desktop notification. With `markup` (the server reads freedesktop.org body-markup), the kept
// tags render and everything else is escaped, so it shows as written; tags always come out balanced, since a server
// that cannot read the markup may drop the notification. Without `markup`, the kept tags are dropped.
// Either way every link is followed by its address, so it is plain that it is a link and where it goes.
export function richText(value, { markup }) {
  const text = terminalSafe(value);
  const asText = markup ? escapeMarkup : (part) => part;
  const open = [];
  let out = "";
  let at = 0;
  const closeLink = (link, sourceEnd) => {
    const label = text.slice(link.labelStart, sourceEnd);
    return `${markup ? "</a>" : ""}${label === link.url ? "" : ` (${asText(link.url)})`}`;
  };
  const close = (tag, sourceEnd) => (tag.name === "a" ? closeLink(tag, sourceEnd) : markup ? `</${tag.name}>` : "");

  for (const match of text.matchAll(KEPT_TAG)) {
    const [whole, slash, name, , url] = match;
    out += asText(text.slice(at, match.index));
    at = match.index + whole.length;
    const top = open.at(-1);
    if (url !== undefined && !open.some((tag) => tag.name === "a")) {
      open.push({ name: "a", url, labelStart: at });
      out += markup ? `<a href="${escapeMarkup(url)}">` : "";
    } else if (name && !slash) {
      open.push({ name });
      out += markup ? `<${name}>` : "";
    } else if (url === undefined && top?.name === (name ?? "a")) {
      open.pop();
      out += close(top, match.index);
    } else {
      out += asText(whole);
    }
  }
  out += asText(text.slice(at));
  while (open.length > 0) out += close(open.pop(), text.length);
  return out;
}
