// The visible achievements (docs/superpowers/specs/2026-10-20-evolo-achievements-design.md section 3) and the readers
// of ledger records that every rule shares. A rule's `value(records)` reads every record, of any status, sorted by
// landedAt, and never goes down when a record is added at the end: achievements.mjs dates each tier on that promise.
import { posix } from "node:path";
import { COUNTED_CLASSES } from "../facts.mjs";
import { landedAt, localDay } from "../ledger.mjs";
import { CRITERIA } from "../score.mjs";
import { streakOf } from "../stats.mjs";

export const scored = (records) => records.filter((record) => record.status === "scored");
// Scored units the judge scored: units triaged by rule carry fixed scores that say nothing about the work.
export const judged = (records) => scored(records).filter((record) => record.result?.method === "ai");
export const scoreOf = (record, criterion) => record.result.evaluation.scores[criterion].score;
export const typeOf = (record) => record.result?.evaluation?.contribution_type;
export const landedDate = (record) => new Date(landedAt(record));
export const commitsOf = (record) => record.result?.facts?.commits ?? [];
export const filesOf = (record) => record.result?.facts?.files ?? [];
export const commitDates = (record) => commitsOf(record).map((commit) => new Date(commit.date));
export const count = (records, predicate) => records.filter(predicate).length;
export const distinct = (values) => new Set(values).size;
export const sum = (values) => values.reduce((total, value) => total + value, 0);
const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;
// "feat(cli)!: subject", the Conventional Commits form CLAUDE.md asks for.
const CONVENTIONAL_SUBJECT = /^(feat|fix|refactor|docs|test|chore|perf|ci|build|style|revert)(\([^)]+\))?!?: \S/;
const CO_AUTHORED = /^co-authored-by:/im;
const mondayOf = (date) => localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)));

// How many of `values` there are of each, as a Map (Map.groupBy needs Node 21).
function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

// The sum of `amountOf` per key, as a Map.
function totals(items, keyOf, amountOf) {
  const sums = new Map();
  for (const item of items) sums.set(keyOf(item), (sums.get(keyOf(item)) ?? 0) + amountOf(item));
  return sums;
}

// Calendar weeks with a unit on each of Monday to Friday.
function fullWeeks(units) {
  const workdays = new Map();
  for (const date of units.map(landedDate).filter((landed) => !isWeekend(landed))) {
    workdays.set(mondayOf(date), new Set(workdays.get(mondayOf(date))).add(date.getDay()));
  }
  return count([...workdays.values()], (days) => days.size === 5);
}

// Lines added and deleted in the unit's source and test files, the lines its size is counted in.
export function countedChange(record) {
  const files = filesOf(record).filter((file) => COUNTED_CLASSES.has(file.class));
  return { added: sum(files.map((file) => file.additions)), deleted: sum(files.map((file) => file.deletions)) };
}

const LANGUAGE_EXTENSIONS = {
  JavaScript: ["js", "mjs", "cjs", "jsx"], TypeScript: ["ts", "mts", "cts", "tsx"], Python: ["py"], Go: ["go"],
  Rust: ["rs"], Java: ["java"], Kotlin: ["kt", "kts"], Swift: ["swift"], C: ["c", "h"], "C++": ["cc", "cpp", "cxx", "hpp", "hh"],
  "C#": ["cs"], Ruby: ["rb"], PHP: ["php"], Shell: ["sh", "bash", "zsh"], SQL: ["sql"], HTML: ["html", "htm"],
  CSS: ["css", "scss", "sass", "less"], Lua: ["lua"], Dart: ["dart"], Scala: ["scala"], Elixir: ["ex", "exs"],
  Erlang: ["erl"], Haskell: ["hs"], Clojure: ["clj", "cljs"], Vue: ["vue"], Svelte: ["svelte"], R: ["r"], Julia: ["jl"],
  Zig: ["zig"], OCaml: ["ml"], Perl: ["pl"], PowerShell: ["ps1"], Terraform: ["tf"], Solidity: ["sol"],
};
const LANGUAGES = new Map(Object.entries(LANGUAGE_EXTENSIONS).flatMap(([language, extensions]) => extensions.map((extension) => [extension, language])));

// The language of a file by its extension, or null for one this table does not know.
export const languageOf = (path) => LANGUAGES.get(posix.extname(path).slice(1).toLowerCase()) ?? null;

// Units the judge rated at least `minimum` on `criterion` for work of `type`.
const strongWork = (type, criterion, minimum = 3) => (records) =>
  count(judged(records), (record) => typeOf(record) === type && scoreOf(record, criterion) >= minimum);

// The longest run of `holds` among the units `counts`; units it does not count neither add to the run nor break it.
function longestRun(units, counts, holds) {
  let longest = 0;
  let run = 0;
  for (const unit of units.filter(counts)) {
    run = holds(unit) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

const hasCode = (record) => {
  const { added, deleted } = countedChange(record);
  return added + deleted > 0;
};

export const VISIBLE = [
  { id: "contributor", name: "Contributor", description: "scored units", tiers: [1, 10, 50, 100, 500], value: (records) => scored(records).length },
  { id: "merge-master", name: "Merge Master", description: "merged PRs", tiers: [1, 10, 50, 200], value: (records) => count(scored(records), (record) => record.kind === "pr") },
  {
    id: "hoarder", name: "Hoarder", description: "XP in total", tiers: [1000, 5000, 20000, 50000],
    value: (records) => sum(scored(records).map((record) => record.xp)),
  },
  { id: "jackpot", name: "Jackpot", description: "units worth 200+ XP", tiers: [1, 5, 20, 50, 100], value: (records) => count(scored(records), (record) => record.xp >= 200) },
  {
    id: "overdrive", name: "Overdrive", description: "XP in your best day", tiers: [300, 600, 1000, 2000],
    value: (records) => Math.max(0, ...totals(scored(records), (record) => localDay(landedDate(record)), (record) => record.xp).values()),
  },
  { id: "builder", name: "Builder", description: "features with impact ≥ 3", tiers: [3, 10, 30, 50], value: strongWork("feature", "impact") },
  { id: "bug-hunter", name: "Bug Hunter", description: "bugfixes with impact ≥ 3", tiers: [3, 10, 30, 50], value: strongWork("bugfix", "impact") },
  { id: "architect", name: "Architect", description: "refactors with centrality ≥ 3", tiers: [3, 10, 30, 40], value: strongWork("refactor", "centrality") },
  { id: "guardian", name: "Guardian", description: "security work with impact ≥ 3", tiers: [1, 5, 15, 25], value: strongWork("security", "impact") },
  { id: "speed-demon", name: "Speed Demon", description: "performance work with impact ≥ 3", tiers: [1, 5, 15, 20], value: strongWork("performance", "impact") },
  { id: "scribe", name: "Scribe", description: "docs with impact ≥ 2", tiers: [3, 10, 30, 60], value: strongWork("docs", "impact", 2) },
  { id: "test-pilot", name: "Test Pilot", description: "test work with quality ≥ 3", tiers: [3, 10, 30, 60], value: strongWork("test", "quality") },
  { id: "plumber", name: "Plumber", description: "infra work with impact ≥ 2", tiers: [3, 10, 30, 40], value: strongWork("infra", "impact", 2) },
  {
    id: "exterminator", name: "Exterminator", description: "units that closed a bug issue", tiers: [1, 5, 20, 50, 100],
    value: (records) => count(scored(records), (record) => record.signals?.closesBugIssue === true),
  },
  {
    id: "craftsman", name: "Craftsman", description: "units with quality 4", tiers: [5, 20, 50],
    value: (records) => count(judged(records), (record) => scoreOf(record, "quality") === 4),
  },
  {
    id: "perfectionist", name: "Perfectionist", description: "units with 4 on every criterion", tiers: [1, 3, 10],
    value: (records) => count(judged(records), (record) => CRITERIA.every((criterion) => scoreOf(record, criterion) === 4)),
  },
  {
    id: "hard-mode", name: "Hard Mode", description: "units with difficulty 4", tiers: [1, 5, 20, 50],
    value: (records) => count(judged(records), (record) => scoreOf(record, "difficulty") === 4),
  },
  {
    id: "on-target", name: "On Target", description: "units with scope fit 4", tiers: [5, 20, 50, 100],
    value: (records) => count(judged(records), (record) => scoreOf(record, "scope_fit") === 4),
  },
  {
    id: "tiny-but-mighty", name: "Tiny but Mighty", description: "units of 1-10 counted lines with impact ≥ 3", tiers: [1, 5, 15, 30],
    value: (records) => count(judged(records), (record) => {
      const { added, deleted } = countedChange(record);
      return added + deleted >= 1 && added + deleted <= 10 && scoreOf(record, "impact") >= 3;
    }),
  },
  {
    id: "janitor", name: "Janitor", description: "units deleting 20+ more counted lines than they add", tiers: [3, 10, 30, 75],
    value: (records) => count(scored(records), (record) => {
      const { added, deleted } = countedChange(record);
      return deleted - added >= 20;
    }),
  },
  {
    id: "test-believer", name: "Test Believer", description: "units in a row with code that touched tests at quality ≥ 3", tiers: [3, 10, 25, 100],
    value: (records) => longestRun(
      judged(records),
      (record) => hasCode(record) && record.result.facts.repoHasTests,
      (record) => record.result.facts.testsTouched && scoreOf(record, "quality") >= 3,
    ),
  },
  {
    id: "green-light", name: "Green Light", description: "merged PRs whose CI passed on the first run", tiers: [3, 10, 30, 100, 200],
    value: (records) => count(scored(records), (record) => record.kind === "pr" && record.signals?.ciFirstPass === true),
  },
  {
    id: "core-contributor", name: "Core Contributor", description: "units with impact 4 and centrality 4 in one repository", tiers: [1, 5, 15],
    value: (records) => {
      const core = judged(records).filter((record) => scoreOf(record, "impact") === 4 && scoreOf(record, "centrality") === 4);
      return Math.max(0, ...tally(core.map((record) => record.repo)).values());
    },
  },
  {
    id: "streak", name: "Streak", description: "longest run of workdays", tiers: [5, 10, 30, 60, 120],
    // The run up to the last unit: later days without work cannot make the longest run longer.
    value: (records) => {
      const units = scored(records);
      return units.length === 0 ? 0 : streakOf(units, new Date(Math.max(...units.map((record) => landedDate(record).getTime())))).longest;
    },
  },
  {
    id: "hat-trick", name: "Hat Trick", description: "days with 3 or more units", tiers: [1, 5, 20, 50, 100],
    value: (records) => count([...tally(scored(records).map((record) => localDay(landedDate(record)))).values()], (units) => units >= 3),
  },
  { id: "full-week", name: "Full Week", description: "weeks with a unit on every workday", tiers: [1, 4, 12, 26, 52], value: (records) => fullWeeks(scored(records)) },
  {
    id: "night-owl", name: "Night Owl", description: "units with a commit between midnight and 5 am", tiers: [3, 10, 30, 100],
    value: (records) => count(scored(records), (record) => commitDates(record).some((date) => date.getHours() < 5)),
  },
  {
    id: "early-bird", name: "Early Bird", description: "units with a commit between 5 and 7 am", tiers: [3, 10, 30, 100],
    value: (records) => count(scored(records), (record) => commitDates(record).some((date) => date.getHours() >= 5 && date.getHours() < 7)),
  },
  {
    id: "weekend-warrior", name: "Weekend Warrior", description: "units landed on a weekend", tiers: [3, 10, 30, 100],
    value: (records) => count(scored(records), (record) => isWeekend(landedDate(record))),
  },
  { id: "explorer", name: "Explorer", description: "repositories", tiers: [2, 5, 10, 25], value: (records) => distinct(scored(records).map((record) => record.repo)) },
  {
    id: "polyglot", name: "Polyglot", description: "languages", tiers: [2, 3, 5, 8, 12, 20],
    value: (records) => distinct(scored(records)
      .flatMap(filesOf)
      .filter((file) => file.class === "source")
      .map((file) => languageOf(file.path))
      .filter(Boolean)),
  },
  {
    id: "by-the-book", name: "By the Book", description: "commits with a Conventional Commits subject", tiers: [10, 50, 200, 500, 1000],
    value: (records) => sum(scored(records).map((record) => count(commitsOf(record), (commit) => CONVENTIONAL_SUBJECT.test(commit.subject ?? "")))),
  },
  {
    id: "co-pilot", name: "Co-pilot", description: "units with a co-authored commit", tiers: [1, 10, 50, 150, 300],
    value: (records) => count(scored(records), (record) => commitsOf(record).some((commit) => CO_AUTHORED.test(commit.body ?? ""))),
  },
];
