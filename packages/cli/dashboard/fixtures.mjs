// Test helper for the dashboard's screen tests, not a drawing module: it is not in MODULES and never bundled into the
// page, so unlike the drawing modules it reads src/. `sampleModel()` is the model `dashboardModel` builds from a small
// but realistic ledger, review store and queue, so the screens are tested on the exact shape the page receives.
// Times carry +07:00: a test file that checks local days or times fixes `process.env.TZ = "Asia/Ho_Chi_Minh"` first.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardModel } from "../src/dashboard.mjs";
import { writeRecords } from "../src/ledger.mjs";
import { addJob, updateJob } from "../src/queue.mjs";
import { reportData, saveReport, storedReport } from "../src/report.mjs";
import { writeReview } from "../src/review.mjs";
import { periodOf } from "../src/stats.mjs";

// A Wednesday; its week started on Monday 2026-10-19.
export const SAMPLE_NOW = new Date("2026-10-21T13:00:00+07:00");
export const EVOLO = "hiinguyen/evolo";
export const ORGS = "hiinguyen/ai-orgs";

const local = (date, time = "12:00") => `${date}T${time}:00+07:00`;
const JUDGE = { backend: "claude", model: "claude-sonnet-5-5" };

const rubric = (impact, centrality, difficulty, quality, scopeFit, evidence) => ({
  impact: { score: impact, reason: "Changes what every later command shows to the user.", evidence: [evidence] },
  centrality: { score: centrality, reason: "Touches the code every view goes through.", evidence: [evidence] },
  difficulty: { score: difficulty, reason: "Needs care with time zones and day boundaries.", evidence: [evidence] },
  quality: { score: quality, reason: "Small functions, tests beside the code.", evidence: [evidence] },
  scope_fit: { score: scopeFit, reason: "One focused change.", evidence: [] },
});

const breakdown = (base, raw, value, mValue, mSize, mRepo, mSignals) =>
  ({ formula_version: "1.2", base, raw, value, mValue, mSize, mRepo, mSignals, reverted: false });

const commit = (sha, subject, date, revertedBy = []) => ({ sha, subject, date, revertedBy });

// One record as the worker writes it: an AI judgment unless `method` says rule, with the facts the page reads. `xp` is
// what the unit was scored at; a unit no longer scored is worth 0 and keeps that XP in its result, as refreshLedger does.
function record({ repo, id, kind = "push", status = "scored", previousStatus, xp, landed, at = landed, summary, type = "feature",
  method = "ai", scores, costUsd = 0.1, files, commits, pr = null, failures = [], issues = [], flags = [], parts, signals }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const counted = files.filter((file) => file.class === "source" || file.class === "test").reduce((sum, file) => sum + file.additions, 0);
  const evaluation = status === "failed" ? undefined
    : { rubric_version: "1.0", contribution_type: type, scores, summary, flags, notes: "long notes the page never shows" };
  return {
    id, repo, kind, status, ...(previousStatus ? { previousStatus } : {}), xp: status === "scored" ? xp : 0, summary, at, landedAt: landed,
    ...(signals ? { signals } : {}),
    result: {
      method, ...(method === "ai" ? { judge: JUDGE } : {}), costUsd, failures, issues, status: status === "failed" ? "failed" : "ok",
      ...(evaluation ? { evaluation, xp, breakdown: parts } : {}),
      facts: {
        kind, id, diffMode: "net", pr, commits, excluded: [], files,
        totals: { files: files.length, additions, deletions, countedLines: counted },
        testsTouched: files.some((file) => file.class === "test"), repoHasTests: true, reverted: status === "reverted",
      },
    },
  };
}

const file = (path, cls, additions, deletions = 0) => ({ path, class: cls, additions, deletions });

const RECORDS = [
  record({
    repo: EVOLO, id: "push-a2205df-b31f0c4", xp: 10, landed: local("2026-10-21", "10:05"), at: local("2026-10-21", "10:06"),
    summary: "Small documentation edit.", type: "docs", method: "rule", costUsd: 0,
    scores: { impact: { score: 1 }, centrality: { score: 0 }, difficulty: { score: 0 }, quality: { score: 2 }, scope_fit: { score: 4 } },
    files: [file("docs/handoff.md", "docs", 6, 2)], commits: [commit("b31f0c4e", "docs: note the local time fix", local("2026-10-21", "10:01"))],
    parts: breakdown(15, 9.8, 0.4, 0.53, 0.5, 0.8, 1),
  }),
  record({
    repo: EVOLO, id: "push-7c1d2e9-a2205df", xp: 60, landed: local("2026-10-21", "09:12"), at: local("2026-10-21", "09:14"),
    summary: "Show stored times in the local time zone across status, why and stats.", type: "bugfix", costUsd: 0.12,
    scores: rubric(2, 3, 2, 3, 4, "src/ledger.mjs:85-88"),
    files: [file("src/ledger.mjs", "source", 18, 4), file("src/ledger.test.mjs", "test", 42), file("bin/evolo.mjs", "source", 6, 6)],
    commits: [commit("a2205df1", "fix: show stored times in the local time zone", local("2026-10-21", "09:05"))],
    parts: breakdown(50, 58.4, 2.6, 2.04, 0.79, 0.8, 1.05), signals: { ciFirstPass: true, cleanMerge: false, closesBugIssue: false, final: true },
  }),
  record({
    repo: ORGS, id: "pr-1", kind: "pr", xp: 125, landed: local("2026-10-20", "22:21"), at: local("2026-10-20", "22:31"),
    summary: "Built the phase 1 foundation of AI Agent World: the domain model, a seeded simulation engine and its tests.",
    costUsd: 0.08, scores: rubric(3, 4, 3, 3, 1, "src/engine/tick.ts:12-40"), flags: ["mostly_generated_code"],
    issues: ["dropped evidence at an unknown path: src/missing.ts"],
    files: [file("src/engine/tick.ts", "source", 420, 0), file("src/engine/tick.test.ts", "test", 180), file("package-lock.json", "lockfile", 7599)],
    commits: [commit("8d3a1c3f", "feat: scaffold the app", local("2026-10-20", "18:02")), commit("fe02c3ed", "feat: add the simulation engine", local("2026-10-20", "21:40"))],
    pr: { number: 1, title: "feat: phase 1 - scaffold, domain model and simulation engine", url: "https://github.com/hiinguyen/ai-orgs/pull/1", mergedAt: local("2026-10-20", "22:21") },
    parts: breakdown(60, 125.21, 3.25, 2.48, 1, 0.8, 1.05), signals: { ciFirstPass: true, cleanMerge: false, closesBugIssue: false, final: true },
  }),
  record({
    repo: EVOLO, id: "push-5e0b7a1-7c1d2e9", status: "failed", xp: 0, landed: local("2026-10-19", "17:40"),
    summary: "attempt 1: the judge did not answer in time | attempt 2: the judge did not answer in time",
    failures: ["attempt 1: the judge did not answer in time", "attempt 2: the judge did not answer in time"],
    files: [file("src/worker.mjs", "source", 30, 12)], commits: [commit("7c1d2e9a", "refactor: split the worker loop", local("2026-10-19", "17:30"))],
  }),
  record({
    repo: EVOLO, id: "push-c94e2f0-5e0b7a1", status: "reverted", previousStatus: "scored", xp: 40, landed: local("2026-10-16", "15:20"),
    summary: "Cache the summary between commands.", scores: rubric(2, 2, 1, 2, 3, "src/ledger.mjs:101-111"),
    files: [file("src/ledger.mjs", "source", 24, 3)],
    commits: [commit("5e0b7a1c", "perf: cache the summary", local("2026-10-16", "15:12"), ["d00d1e5f"])],
    parts: breakdown(50, 41.2, 2.1, 1.69, 0.61, 0.8, 1),
  }),
  record({
    repo: EVOLO, id: "pr-7", kind: "pr", xp: 300, landed: local("2026-10-08", "16:45"), costUsd: 0.15,
    summary: "Added achievements: a catalog of tiers computed from the ledger, desktop notices and `evolo achievements`.",
    scores: rubric(3, 3, 3, 3, 3, "src/achievements.mjs:43-58"),
    files: [file("src/achievements.mjs", "source", 140), file("src/achievements.test.mjs", "test", 220), file("docs/achievements.md", "docs", 90)],
    commits: [commit("1f2e3d4c", "feat: add achievements", local("2026-10-08", "14:00"))],
    pr: { number: 7, title: "feat: add achievements", url: "https://github.com/hiinguyen/evolo/pull/7", mergedAt: local("2026-10-08", "16:45") },
    parts: breakdown(60, 301.5, 3, 2.31, 1.36, 0.8, 1.1),
  }),
  record({
    repo: EVOLO, id: "push-9a8b7c6-1f2e3d4", xp: 180, landed: local("2026-10-07", "11:30"), summary: "Added `evolo stats` for a calendar week, month or quarter.",
    scores: rubric(3, 3, 2, 3, 3, "src/stats.mjs:98-121"), files: [file("src/stats.mjs", "source", 160), file("src/stats.test.mjs", "test", 140)],
    commits: [commit("9a8b7c6d", "feat: add evolo stats", local("2026-10-07", "11:20"))], parts: breakdown(60, 182, 2.8, 2.18, 1.3, 0.8, 1),
  }),
  record({
    repo: ORGS, id: "push-root-3c4d5e6", xp: 120, landed: local("2026-10-06", "20:10"), summary: "Set up the repository with a README and CI.",
    type: "chore", scores: rubric(2, 1, 1, 3, 4, "README.md:1-20"), files: [file("README.md", "docs", 40), file(".github/workflows/ci.yml", "config", 30)],
    commits: [commit("3c4d5e6f", "chore: set up the repository", local("2026-10-06", "20:00"))], parts: breakdown(40, 118, 1.8, 1.49, 1, 0.8, 1),
  }),
  record({
    repo: ORGS, id: "push-root-0a1b2c3", xp: 245, landed: local("2026-09-29", "15:00"), summary: "Wrote the first plan of the agent world with its domain glossary.",
    type: "docs", scores: rubric(3, 2, 2, 3, 3, "docs/PLAN.md:1-80"), files: [file("docs/PLAN.md", "docs", 600)],
    commits: [commit("0a1b2c3d", "docs: plan the agent world", local("2026-09-29", "14:50"))], parts: breakdown(40, 246, 2.9, 2.24, 1.5, 0.8, 1),
  }),
];

const REVIEW = {
  repo: ORGS, unitId: "pr-1", tip: "fe02c3ed", at: local("2026-10-21", "11:30"), language: "en", judge: JUDGE, costUsd: 0.21, durationMs: 41000,
  review: {
    overview: "A solid first phase: the engine is deterministic and tested, but the tick loop mixes scheduling with state updates.",
    strengths: ["The seeded random source makes every simulation repeatable.", "Each engine module has its own tests."],
    improvements: ["Split scheduling from the state updates in the tick loop."],
    findings: [
      { severity: "medium", category: "design", location: "src/engine/tick.ts:42-48", title: "Tick mixes scheduling and updates", detail: "The loop both picks the next agent and mutates the world.", suggestion: "Return the next state from a pure function." },
      { severity: "low", category: "test", location: "src/engine/tick.test.ts:10", title: "One seed only", detail: "Every test uses seed 1.", suggestion: "Add a second seed." },
    ],
  },
  issues: [],
};

function build() {
  const home = mkdtempSync(join(tmpdir(), "evolo-sample-"));
  try {
    for (const repo of [EVOLO, ORGS]) writeRecords(home, repo, RECORDS.filter((entry) => entry.repo === repo));
    writeReview(home, REVIEW);
    saveReport(home, sampleReport());
    addJob(home, { type: "push", repo: EVOLO, from: "b31f0c4", to: "c7d8e9f" });
    const parked = addJob(home, { type: "pr", repo: ORGS, number: 2 });
    updateJob(home, { ...parked, budgetDay: "2026-10-21" });
    return dashboardModel(home, SAMPLE_NOW);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// The report of the sample's week as `evolo report` saves it, written in the morning of SAMPLE_NOW from the same data,
// so it is not stale: the agent world's PR and Evolo's time fix are its highlights.
const HIGHLIGHT_TEXTS = ["It laid the agent world's foundation, with a deterministic engine.", "It fixed the times every view shows."];

function sampleReport() {
  const data = reportData(RECORDS, [REVIEW], periodOf("week", SAMPLE_NOW), SAMPLE_NOW);
  const [first, second] = data.input.highlights;
  const report = {
    overview: "A week split between Evolo's views and the agent world's first phase, with tests beside most of the code.",
    highlights: data.input.highlights.map((unit, index) => ({ unit, text: HIGHLIGHT_TEXTS[index] })),
    strengths: [{ text: "Kept each change small and tested.", units: [first, second] }],
    improvements: [{ text: "The tick loop mixes scheduling with state updates: split them before the next phase.", units: [first] }],
    flags: [],
    notes: "",
  };
  const written = { report, issues: [], judge: JUDGE, costUsd: 0.04, durationMs: 9000 };
  return storedReport({ data, written, language: "en", at: local("2026-10-21", "08:00") });
}

let built = null;

// A fresh copy each time, so a test that changes its model cannot leak into the next one.
export function sampleModel() {
  built ??= build();
  return structuredClone(built);
}

// The model a generated page carries, read the way the browser reads it: the text between the opening tag of the data
// block and the first `</script>` after it.
export function modelIn(page) {
  const start = page.indexOf('<script type="application/json" id="model">');
  if (start === -1) throw new Error("the page has no model block");
  const from = page.indexOf(">", start) + 1;
  return JSON.parse(page.slice(from, page.indexOf("</script>", from)));
}
