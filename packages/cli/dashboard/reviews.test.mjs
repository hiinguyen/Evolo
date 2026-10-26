// The Reviews screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHash } from "./app.mjs";
import { EVOLO, sampleModel } from "./fixtures.mjs";
import { filterReviews, renderReviews, reviewsHash } from "./reviews.mjs";

// The visible text of `html`, with tags dropped and runs of space joined, to match sentences that span elements.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (html, needle) => html.split(needle).length - 1;
const links = (html) => [...html.matchAll(/<a class="review-card" href="([^"]*)"/g)].map(([, href]) => href);
const labels = (html) => [...html.matchAll(/<span class="review-label[^"]*">([^<]*)<\/span>/g)].map(([, label]) => label);

const finding = (severity) => ({ severity, category: "design", location: "src/a.mjs:1", title: "A finding", detail: "Why it matters." });

// The sample model with three reviews, newest first as the model holds them: the sample's PR #1 (one medium and one
// low finding), a push of Evolo with a high finding, and an older PR with no findings at all.
function threeReviews() {
  const model = sampleModel();
  const [stored] = model.reviews;
  const push = {
    ...stored, key: `${EVOLO}/push-7c1d2e9-a2205df`, repo: EVOLO, unitId: "push-7c1d2e9-a2205df", label: "push 7c1d2e9..a2205df",
    at: "2026-10-21T08:00:00.000Z", language: "vi", xp: 60, kind: "push",
    review: { ...stored.review, overview: "Sửa giờ hiển thị cho đúng múi giờ địa phương.", findings: [finding("high"), finding("low"), finding("low")] },
  };
  const quiet = { ...stored, key: `${EVOLO}/pr-7`, repo: EVOLO, unitId: "pr-7", label: "PR #7", at: "2026-10-09T03:00:00.000Z", xp: 300, kind: "pr",
    review: { ...stored.review, overview: "Clean.", findings: [] } };
  return { ...model, reviews: [stored, push, quiet] };
}

test("every review is a card, in the model's order, newest first", () => {
  const html = renderReviews(threeReviews(), {});
  assert.equal(count(html, 'class="review-card"'), 3);
  assert.deepEqual(labels(html), ["PR #1", "push 7c1d2e9..a2205df", "PR #7"]);
  assert.match(textOf(html), /Reviews 3 reviews /);
});

test("a card shows the unit, its repository, the local day, the language, the overview and the findings by severity", () => {
  const html = renderReviews(threeReviews(), {});
  const text = textOf(html);
  assert.match(text, /PR #1 hiinguyen\/ai-orgs • 2026-10-21 • en • claude-sonnet-5-5 · \$0\.21 • 41s/);
  assert.match(text, /push 7c1d2e9\.\.a2205df hiinguyen\/evolo • 2026-10-21 • vi/);
  assert.match(html, /<time datetime="2026-10-21T11:30:00\+07:00">2026-10-21<\/time>/);
  assert.match(html, /<span class="pill sev-medium">1 medium<\/span><span class="pill sev-low">1 low<\/span>/);
  assert.match(html, /<span class="pill sev-high">1 high<\/span><span class="pill sev-low">2 low<\/span>/);
  assert.match(text, /PR #7 hiinguyen\/evolo • 2026-10-09 .* Clean\. No findings/);
  // The whole overview is in the page; the card shows its first lines.
  assert.match(html, /<p class="review-overview">A solid first phase: the engine is deterministic and tested, but the tick loop mixes scheduling with state updates\.<\/p>/);
  // The unit's current XP and the top finding titles are on the card.
  assert.match(html, /<span class="review-xp">\+125 XP<\/span>/);
  assert.match(text, /Tick mixes scheduling and updates/);
  assert.match(text, /One seed only/);
});

test("a finding of a severity the page does not know counts as low, as the unit's Review tab shows it", () => {
  const model = threeReviews();
  const [stored] = model.reviews;
  const odd = { ...model, reviews: [{ ...stored, review: { ...stored.review, findings: [finding("critical")] } }] };
  assert.match(renderReviews(odd, {}), /<span class="pill sev-low">1 low<\/span>/);
  assert.equal(count(renderReviews(odd, { severity: "low" }), 'class="review-card"'), 1);
});

test("each card links to the Review tab of its unit, every part of the key encoded", () => {
  assert.deepEqual(links(renderReviews(threeReviews(), {})), [
    "#/unit/hiinguyen/ai-orgs/pr-1/review",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
    "#/unit/hiinguyen/evolo/pr-7/review",
  ]);
  const model = threeReviews();
  const odd = { ...model, reviews: [{ ...model.reviews[0], key: 'me/a"b?c/pr-1' }] };
  assert.deepEqual(links(renderReviews(odd, {})), ["#/unit/me/a%22b%3Fc/pr-1/review"]);
});

test("the severity filter keeps the reviews with at least one finding of that severity", () => {
  const model = threeReviews();
  const high = renderReviews(model, { severity: "high" });
  assert.deepEqual(links(high), ["#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review"]);
  assert.match(textOf(high), /Reviews 1 of 3 reviews /);
  assert.deepEqual(links(renderReviews(model, { severity: "medium" })), ["#/unit/hiinguyen/ai-orgs/pr-1/review"]);
  assert.deepEqual(links(renderReviews(model, { severity: "low" })), [
    "#/unit/hiinguyen/ai-orgs/pr-1/review",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
  ]);
  // An unknown severity is no filter, like a missing one.
  assert.equal(count(renderReviews(model, { severity: "urgent" }), 'class="review-card"'), 3);
  assert.equal(model.reviews.length, 3, "the model passed in is not changed");
});

test("the search matches every word across the review, its unit and its findings", () => {
  const model = threeReviews();
  assert.deepEqual(links(renderReviews(model, { q: "deterministic" })), ["#/unit/hiinguyen/ai-orgs/pr-1/review"]);
  assert.deepEqual(links(renderReviews(model, { q: "seed only" })), ["#/unit/hiinguyen/ai-orgs/pr-1/review"], "a finding is searched");
  assert.deepEqual(links(renderReviews(model, { q: "SỬA GIỜ" })), ["#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review"], "case folds");
  assert.deepEqual(links(renderReviews(model, { q: "evolo" })), [
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
    "#/unit/hiinguyen/evolo/pr-7/review",
  ], "the repository is searched");
  assert.equal(count(renderReviews(model, { q: "   " }), 'class="review-card"'), 3, "blank text is no search");
  assert.equal(count(renderReviews(model, { q: "no such text" }), 'class="review-card"'), 0);
});

test("the order select sorts by date, findings and XP", () => {
  const model = threeReviews();
  assert.deepEqual(links(renderReviews(model, { sort: "old" })), [
    "#/unit/hiinguyen/evolo/pr-7/review",
    "#/unit/hiinguyen/ai-orgs/pr-1/review",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
  ]);
  assert.deepEqual(links(renderReviews(model, { sort: "findings" })), [
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
    "#/unit/hiinguyen/ai-orgs/pr-1/review",
    "#/unit/hiinguyen/evolo/pr-7/review",
  ]);
  assert.deepEqual(links(renderReviews(model, { sort: "xp" })), [
    "#/unit/hiinguyen/evolo/pr-7/review",
    "#/unit/hiinguyen/ai-orgs/pr-1/review",
    "#/unit/hiinguyen/evolo/push-7c1d2e9-a2205df/review",
  ]);
  // An unknown order is the default, and the model is not changed.
  assert.deepEqual(links(renderReviews(model, { sort: "loudest" })), links(renderReviews(model, {})));
  assert.deepEqual(model.reviews.map((review) => review.label), ["PR #1", "push 7c1d2e9..a2205df", "PR #7"]);
  assert.deepEqual(filterReviews(model.reviews, { q: "clean" }).map((review) => review.label), ["PR #7"]);
});

test("the toolbar keeps the search, the order and the severity, and the severity links keep the other two", () => {
  const html = renderReviews(threeReviews(), { q: "local", sort: "findings", severity: "low" });
  assert.match(html, /<form class="filters reviews-filters" data-screen="reviews"/);
  assert.match(html, /<input type="hidden" name="severity" data-filter value="low">/);
  assert.match(html, /<input type="search" name="q" data-filter value="local"/);
  assert.match(html, /<option value="findings" selected>Most findings<\/option>/);
  const segments = (page) => [...page.matchAll(/<a class="segment" href="([^"]*)"( aria-current="page")?>([\s\S]*?)<\/a>/g)]
    .map(([, href, open, body]) => `${body.replace(/<span class="segment-count">.*?<\/span>/, "").replace(/<[^>]*>/g, "").trim()} ${href}${open ? " *" : ""}`);
  assert.deepEqual(segments(html), [
    "All #/reviews?sort=findings&amp;q=local",
    "High #/reviews?severity=high&amp;sort=findings&amp;q=local",
    "Medium #/reviews?severity=medium&amp;sort=findings&amp;q=local",
    "Low #/reviews?severity=low&amp;sort=findings&amp;q=local *",
  ]);
});

test("the filter is a row of links, the open one marked, each with its own address", () => {
  const segments = (html) => [...html.matchAll(/<a class="segment" href="([^"]*)"( aria-current="page")?>([\s\S]*?)<\/a>/g)]
    .map(([, href, open, body]) => `${body.replace(/<span class="segment-count">.*?<\/span>/, "").replace(/<[^>]*>/g, "").trim()} ${href}${open ? " *" : ""}`);
  assert.deepEqual(segments(renderReviews(threeReviews(), {})), [
    "All #/reviews *", "High #/reviews?severity=high", "Medium #/reviews?severity=medium", "Low #/reviews?severity=low",
  ]);
  assert.deepEqual(segments(renderReviews(threeReviews(), { severity: "medium" })), [
    "All #/reviews", "High #/reviews?severity=high", "Medium #/reviews?severity=medium *", "Low #/reviews?severity=low",
  ]);
});

test("the rail totals the whole set: severity, categories, spend and coverage", () => {
  const text = textOf(renderReviews(threeReviews(), {}));
  assert.match(text, /Review insights &amp; health 5 findings 33% Clean reviews 1 of 3 reviews written without a finding Reviews 3 With findings 2 \/ 3 Avg review 41s Judge spend \$0\.63/);
  assert.match(text, /Finding breakdown 5 flags High 1 Medium 1 Low 3 design 4 test 1/);
  assert.match(text, /Actionable findings 4 tasks/);
  assert.match(text, /Coverage &amp; judges 33% 3 of 9 units reviewed/);
  const empty = renderReviews({ ...sampleModel(), reviews: [] }, {});
  assert.match(textOf(empty), /No reviews yet/);
});

test("a filter that matches no review says so and links back to all of them", () => {
  const model = threeReviews();
  const none = { ...model, reviews: model.reviews.filter((review) => review.unitId !== "push-7c1d2e9-a2205df") };
  const html = renderReviews(none, { severity: "high" });
  assert.equal(count(html, 'class="review-card"'), 0);
  assert.match(textOf(html), /No review has a high finding\. /);
  assert.match(html, /href="#\/reviews">Show all reviews<\/a>/);
  const searched = renderReviews(model, { q: "nothing matches" });
  assert.match(textOf(searched), /No review matches this search\./);
  assert.match(searched, /href="#\/reviews">Clear filters<\/a>/);
});

test("with no review yet, the screen says how to write one", () => {
  const html = renderReviews({ ...sampleModel(), reviews: [] }, {});
  assert.match(textOf(html), /No reviews yet: evolo review writes one for the latest unit/);
  assert.match(html, /<code>evolo review<\/code>/);
  assert.ok(!html.includes('class="segmented"'), "nothing to filter");
});

test("text from a review is escaped", () => {
  const model = threeReviews();
  const [stored] = model.reviews;
  const poisoned = { ...model, reviews: [{ ...stored, label: "<b>PR</b>", repo: "me/<x>", language: "\"en\"", review: { ...stored.review, overview: "<script>alert(1)</script>" } }] };
  const html = renderReviews(poisoned, {});
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;PR&lt;/b&gt;"));
  assert.ok(html.includes("me/&lt;x&gt;"));
  assert.ok(html.includes("&quot;en&quot;"));
});

test("reviewsHash writes only the non-default values and parseHash reads them back", () => {
  assert.equal(reviewsHash({}), "#/reviews");
  assert.equal(reviewsHash({ severity: "", sort: "new", q: "" }), "#/reviews");
  const hash = reviewsHash({ severity: "high", sort: "findings", q: "local time" });
  assert.equal(hash, "#/reviews?severity=high&sort=findings&q=local+time");
  assert.deepEqual(parseHash(hash).query, { severity: "high", sort: "findings", q: "local time" });
  assert.equal(reviewsHash({ severity: "urgent", sort: "loudest" }), "#/reviews");
});
