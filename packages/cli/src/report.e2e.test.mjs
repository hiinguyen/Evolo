// End to end: `evolo report` on units the real worker scored, in the sandbox of sandbox.mjs with the fake judge.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { localDay } from "./ledger.mjs";
import { lines, makeSandbox, REPO, short } from "./sandbox.mjs";
import { periodOf } from "./stats.mjs";

const reportFile = (box) => join(box.home, "reports", "week", `${localDay(periodOf("week").start)}.json`);

// A sandbox with one scored push of `app.js` this week, and its unit id.
async function scoredPush() {
  const box = makeSandbox();
  box.evolo("init", "--remote", "origin");
  const sha = box.commit("feat: start", { "app.js": lines(30, "app") });
  box.push(["origin", "main"]);
  const id = `push-root-${short(sha)}`;
  await box.settled(id);
  return { box, id };
}

test("a report is written in the configured language, saved, shown again without the judge, and redone with --again", async () => {
  const { box, id } = await scoredPush();
  box.evolo("config", "set", "report.language", "vi");

  const first = box.evolo("report");
  assert.match(box.judgeTasks().at(-1), /^Write the performance review of week \S+, a week that is not over yet\. Write the prose fields in this language: vi\./);
  assert.match(first, /^week \S+ {2}\(vs week \S+\)\nreport in vi {2}\S+ \S+ · claude-sonnet-5-5 · \$0\.01\nthe week was not over when this report was written\n/);
  assert.match(first, new RegExp(`\\nhighlights:\\n {2}proj push \\.\\.${id.slice(-7)} {2}\\d+ XP {2}feature\\n {4}Fake highlight\\.\\n`));
  assert.match(first, new RegExp(`\\nstrengths:\\n {2}- Fake strength\\. {2}\\[proj push \\.\\.${id.slice(-7)}\\]\\n`));
  const stored = JSON.parse(readFileSync(reportFile(box), "utf8"));
  assert.equal(stored.language, "vi");
  assert.deepEqual(stored.report.highlights.map((entry) => entry.unit), [`${REPO}/${id}`]);

  const calls = box.judgeCalls();
  assert.equal(box.evolo("report"), first, "a saved report is shown as it was");
  assert.equal(box.judgeCalls(), calls, "showing a saved report does not call the judge");
  box.evolo("report", "--again");
  assert.equal(box.judgeCalls(), calls + 1);
  // A report written again replaces the saved one, cost included, as a review written again does.
  assert.match(box.evolo("status"), /judge spending today \$0\.02 of \$5\.00/, "one scoring and the saved report");
});

test("a period without scored units has nothing to review and costs nothing", async () => {
  const { box } = await scoredPush();
  const calls = box.judgeCalls();
  assert.match(box.evolo("report", "--previous"), /^no scored contributions in week \S+: nothing to review$/m);
  assert.match(box.evolo("report", "quarter", "--previous"), /^no scored contributions in \d{4} Q\d: nothing to review$/m);
  assert.equal(box.judgeCalls(), calls);
  assert.equal(existsSync(join(box.home, "reports")), false);
  assert.equal(box.evoloRun("report", "year").status, 2);
});

test("a saved report says when the ledger changed since, until it is written again", async () => {
  const { box } = await scoredPush();
  box.evolo("report");
  const sha = box.commit("feat: more", { "more.js": lines(20, "more") });
  box.push(["origin", "main"]);
  await box.settled(`push-${short(box.git("rev-parse", "HEAD~1"))}-${short(sha)}`);

  const stale = /^the ledger changed since this report was written: `evolo report week --again` writes it again$/m;
  assert.match(box.evolo("report"), stale);
  assert.doesNotMatch(box.evolo("report", "--again"), stale);
  assert.doesNotMatch(box.evolo("report"), stale);
});

test("a point citing a unit outside the period is dropped and shown, and a report stating numbers is never saved", async () => {
  const { box } = await scoredPush();
  box.setClaudeBadCite(true);
  const text = box.evolo("report");
  assert.doesNotMatch(text, /Invented improvement\. {2}\[/);
  assert.match(text, /\nvalidator:\n {2}dropped an improvement citing a unit not in the period \(nobody\/none\/pr-0\): "Invented improvement\."\n$/);
  box.setClaudeBadCite(false);

  const before = readFileSync(reportFile(box), "utf8");
  const calls = box.judgeCalls();
  box.setClaudeDigits(true);
  const failed = box.evoloRun("report", "--again");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^report failed:\n {2}attempt 1: invalid output: overview has a digit outside inline code/m);
  assert.match(failed.stderr, /^ {2}attempt 3: /m);
  assert.equal(box.judgeCalls(), calls + 3);
  assert.equal(readFileSync(reportFile(box), "utf8"), before, "the saved report is kept");
});
