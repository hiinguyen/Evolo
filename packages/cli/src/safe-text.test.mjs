import assert from "node:assert/strict";
import { test } from "node:test";
import { richText, terminalSafe } from "./safe-text.mjs";

const markup = (text) => richText(text, { markup: true });
const plain = (text) => richText(text, { markup: false });

test("bold, italic, underline and http links are kept, and every link shows where it goes", () => {
  assert.equal(
    markup('Uses <b>Map</b>, <i>lazily</i> & <u>once</u>: <a href="https://ex.com/a?b=1&c=2">docs</a>'),
    'Uses <b>Map</b>, <i>lazily</i> &amp; <u>once</u>: <a href="https://ex.com/a?b=1&amp;c=2">docs</a> (https://ex.com/a?b=1&amp;c=2)',
  );
  assert.equal(markup("<a href='http://ex.com'>http://ex.com</a>"), '<a href="http://ex.com">http://ex.com</a>', "a bare URL is not repeated");
});

test("anything else is shown as written: images, other tags, other link schemes", () => {
  assert.equal(markup('<img src="https://t.example/p.png">'), '&lt;img src="https://t.example/p.png"&gt;');
  assert.equal(markup('<a href="javascript:alert(1)">x</a>'), '&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;');
  assert.equal(markup('<span foreground="red">x</span> <B>y</B>'), '&lt;span foreground="red"&gt;x&lt;/span&gt; &lt;B&gt;y&lt;/B&gt;');
  assert.equal(markup('<a href="https://ex.com" onclick="x">y</a>'), '&lt;a href="https://ex.com" onclick="x"&gt;y&lt;/a&gt;');
});

test("tags always come out balanced, so the notification server can read the markup", () => {
  assert.equal(markup("<b>open"), "<b>open</b>");
  assert.equal(markup("close</b>"), "close&lt;/b&gt;");
  assert.equal(markup("<b><i>x</b></i>"), "<b><i>x&lt;/b&gt;</i></b>");
  assert.equal(markup('<a href="https://a.ex">x <a href="https://b.ex">y</a></a>'), '<a href="https://a.ex">x &lt;a href="https://b.ex"&gt;y</a> (https://a.ex)&lt;/a&gt;');
  assert.equal(markup('<a href="https://a.ex"><b>x'), '<a href="https://a.ex"><b>x</b></a> (https://a.ex)');
});

test("without body markup the tags are dropped, links read as text and URL, and the rest stays as written", () => {
  assert.equal(plain('Uses <b>Map</b> & <a href="https://ex.com">docs</a> <img src=x>'), "Uses Map & docs (https://ex.com) <img src=x>");
  assert.equal(plain("<b>open"), "open");
});

test("control characters are dropped in both modes", () => {
  assert.equal(markup("<b>a\u001b[31mb</b>\r"), "<b>a[31mb</b>");
  assert.equal(plain("a\u001b]0;t\u0007b"), "a]0;tb");
});
