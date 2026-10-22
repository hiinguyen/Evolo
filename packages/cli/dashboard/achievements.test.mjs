// The Achievements screen, drawn from the sample model of fixtures.mjs. Zone fixed so local days do not depend on the machine.
process.env.TZ = "Asia/Ho_Chi_Minh";

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderAchievements } from "./achievements.mjs";
import { sampleModel } from "./fixtures.mjs";

// The visible text of `html`, with tags dropped and runs of space joined, to match sentences that span elements.
const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (html, needle) => html.split(needle).length - 1;

// The markup of the tile whose badge is named `name`: from its <li> to the next one.
function tileOf(html, name) {
  const at = html.indexOf(`<span class="badge-name">${name}</span>`);
  assert.notEqual(at, -1, `no tile named ${name}`);
  const start = html.lastIndexOf("<li", at);
  return html.slice(start, html.indexOf("</li>", at) + "</li>".length);
}

// A model whose one visible achievement is `changes` applied to Contributor.
function withContributor(changes) {
  const model = sampleModel();
  const [contributor] = model.achievements.visible;
  return { ...model, achievements: { ...model.achievements, visible: [{ ...contributor, ...changes }] } };
}

test("the head counts the unlocked achievements, the secrets found and the ones still hidden", () => {
  const model = sampleModel();
  assert.match(textOf(renderAchievements(model)), /Achievements 9 \/ 33 · ★ 2 secrets · \? 26 hidden /);
  const one = { ...model, achievements: { ...model.achievements, secretsFound: model.achievements.secretsFound.slice(0, 1), secretsHidden: 1 } };
  assert.match(textOf(renderAchievements(one)), /Achievements 9 \/ 33 · ★ 1 secret · \? 1 hidden /);
});

test("the achievements come in the catalog's order, then the secrets found, then the hidden ones", () => {
  const model = sampleModel();
  const html = renderAchievements(model);
  const names = [...html.matchAll(/<span class="badge-name">([^<]*)<\/span>/g)].map(([, name]) => name);
  const found = model.achievements.secretsFound.map((entry) => entry.name);
  assert.equal(found.length, 2);
  assert.deepEqual(names, [...model.achievements.visible.map((entry) => entry.name), ...found]);
  assert.ok(html.lastIndexOf('<span class="badge-name">') < html.indexOf('class="secret-slots"'));
});

test("an emblem shows the Roman numeral of the tier reached, a dash before the first, and a star for a secret", () => {
  const mark = (html, name) => tileOf(html, name).match(/<span class="emblem" aria-hidden="true">([^<]*)<\/span>/)[1];
  const model = sampleModel();
  const html = renderAchievements(model);
  assert.equal(mark(html, "Contributor"), "I");
  assert.equal(mark(html, "Bug Hunter"), "–");
  for (const secret of model.achievements.secretsFound) assert.equal(mark(html, secret.name), "★");
  assert.equal(mark(renderAchievements(withContributor({ tier: 3, value: 60 })), "Contributor"), "III");
  assert.equal(mark(renderAchievements(withContributor({ tier: 4, value: 120 })), "Contributor"), "IV");
});

test("each tier is a pip, lit up to the tier reached, and a locked achievement is dimmed", () => {
  const html = renderAchievements(sampleModel());
  const contributor = tileOf(html, "Contributor");
  assert.equal(count(contributor, '<i class="pip'), 5);
  assert.equal(count(contributor, '<i class="pip on">'), 1);
  assert.match(contributor, /aria-label="Tier 1 of 5"/);
  assert.match(contributor, /class="badge"/);
  const locked = tileOf(html, "Bug Hunter");
  assert.match(locked, /class="badge locked"/);
  assert.equal(count(locked, '<i class="pip on">'), 0);
  assert.equal(count(locked, '<i class="pip'), 3);
});

test("progress runs to the next tier, and an achievement at its last tier says max", () => {
  const html = renderAchievements(sampleModel());
  const contributor = tileOf(html, "Contributor");
  assert.match(textOf(contributor), / scored units 7 \/ 10 /);
  assert.match(contributor, /<span style="width:70%"><\/span>/);
  assert.match(contributor, /aria-valuenow="7" aria-valuemax="10"/);
  assert.match(textOf(tileOf(html, "Hoarder")), / 1,040 \/ 5,000 /);
  // A locked achievement counts toward its first tier.
  assert.match(textOf(tileOf(html, "Scribe")), / 1 \/ 3 /);
  // Past the next tier's threshold the bar stops full.
  assert.match(tileOf(renderAchievements(withContributor({ value: 12 })), "Contributor"), /<span style="width:100%"><\/span>/);

  const maxed = tileOf(renderAchievements(withContributor({ tier: 5, value: 640 })), "Contributor");
  assert.match(textOf(maxed), / scored units max /);
  assert.match(maxed, /<span style="width:100%"><\/span>/);
  assert.ok(!maxed.includes(" / "), "no next tier to count toward");
});

test("the day of the highest tier reached is shown in local time, and a locked achievement says so", () => {
  const html = renderAchievements(sampleModel());
  assert.match(textOf(tileOf(html, "Contributor")), / unlocked 2026-09-29 /);
  assert.match(tileOf(html, "Contributor"), /<time datetime="2026-09-29T15:00:00\+07:00">2026-09-29<\/time>/);
  assert.match(textOf(tileOf(html, "Bug Hunter")), / locked /);
  const twice = withContributor({ tier: 2, value: 12, unlocked: [{ tier: 1, at: "2026-09-29T08:00:00.000Z" }, { tier: 2, at: "2026-10-20T18:30:00.000Z" }] });
  // 18:30 UTC is the next day in Ho Chi Minh City.
  assert.match(textOf(tileOf(renderAchievements(twice), "Contributor")), / unlocked 2026-10-21 /);
});

test("a secret found shows its description and the local day it was found, without progress", () => {
  const model = sampleModel();
  const secret = { id: "found", name: "Found One", description: "a thing that happened", at: "2026-10-15T18:30:00.000Z" };
  const tile = tileOf(renderAchievements({ ...model, achievements: { ...model.achievements, secretsFound: [secret] } }), "Found One");
  assert.match(textOf(tile), / a thing that happened unlocked 2026-10-16 /);
  assert.ok(!tile.includes('role="progressbar"'));
});

test("every secret still hidden is one small ? in a group read out as their number, with no name", () => {
  const model = sampleModel();
  const html = renderAchievements(model);
  assert.equal(count(html, 'class="secret-slot"'), model.achievements.secretsHidden);
  assert.equal(count(html, '<span class="secret-slot" aria-hidden="true">?</span>'), 26);
  assert.match(html, /<div class="secret-slots" role="img" aria-label="26 hidden secrets">/);
  const group = html.slice(html.indexOf('<div class="secret-slots"'), html.indexOf("</div>", html.indexOf('<div class="secret-slots"')));
  assert.equal(group.replace(/<span class="secret-slot" aria-hidden="true">\?<\/span>/g, ""), '<div class="secret-slots" role="img" aria-label="26 hidden secrets">',
    "nothing but the circles: no name, no description");
  // The secrets found keep their full tiles, before the circles.
  assert.ok(html.indexOf(model.achievements.secretsFound[1].name) < html.indexOf('class="secret-slots"'));
  const one = renderAchievements({ ...model, achievements: { ...model.achievements, secretsFound: [], secretsHidden: 1 } });
  assert.match(one, /aria-label="1 hidden secret"/);
  assert.match(textOf(one), /Secrets 0 of 1 found /);

  const none = renderAchievements({ ...model, achievements: { ...model.achievements, secretsHidden: 0 } });
  assert.equal(count(none, 'class="secret-slot'), 0);
  assert.match(textOf(none), /Secrets /);
  const nothing = renderAchievements({ ...model, achievements: { ...model.achievements, secretsFound: [], secretsHidden: 0 } });
  assert.ok(!textOf(nothing).includes("Secrets "), "no secrets section without secrets");
});

test("a comparison stays on one line with its number", () => {
  const html = renderAchievements(sampleModel());
  assert.ok(html.includes("refactors with centrality ≥\u00a03"));
  const descriptions = [...html.matchAll(/<span class="badge-desc">([^<]*)<\/span>/g)].map(([, text]) => text);
  assert.equal(descriptions.filter((text) => /[≥≤] \d/.test(text)).length, 0, "no plain space after ≥ before a number");
  assert.ok(renderAchievements(withContributor({ description: "at most ≤ 10 <b>" })).includes("at most ≤\u00a010 &lt;b&gt;"));
});

test("names and descriptions are escaped", () => {
  const html = renderAchievements(withContributor({ name: "<img src=x onerror=alert(1)>", description: "a \"quoted\" <b>bold</b> goal" }));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<b>bold</b>"));
  assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt;"));
  const model = sampleModel();
  const secret = { ...model, achievements: { ...model.achievements, secretsFound: [{ id: "x", name: "<s>found</s>", description: "<i>", at: "2026-10-16T08:20:00.000Z" }] } };
  assert.ok(renderAchievements(secret).includes("&lt;s&gt;found&lt;/s&gt;"));
  assert.ok(!renderAchievements(secret).includes("<s>found"));
});

test("drawing does not change the model", () => {
  const model = sampleModel();
  const before = structuredClone(model);
  renderAchievements(model);
  assert.deepEqual(model, before);
});
