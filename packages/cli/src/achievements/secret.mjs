// Secret achievements: `evolo achievements` shows neither their names nor what they are for until they unlock, and
// the docs do not list them either. Each has one tier, and its value is 1 once it is unlocked, 0 before.
// Rules follow catalog.mjs's promise: the value never goes down when a record is added at the end.
import { levelFor } from "../score.mjs";
import {
  commitDates, commitsOf, count, countedChange, filesOf, judged, landedDate, scored, sum,
} from "./catalog.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMEBACK_DAYS = 14;
const SPEEDRUN_MS = 5 * 60 * 1000;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const LAZY_SUBJECT = /^(wip|fix|fixes|fixed|update|updates|changes|stuff|asdf|test|tmp|temp|oops|minor|done|commit|\.+)$/i;
const RELEASE_SUBJECT = /^chore\(release\):/i;
const SEMVER = /\bv?\d+\.\d+\.\d+\b/;
const DEPLOY_SUBJECT = /^deploy\b/i;
const DEPLOY_WORKFLOW = /(^|\/)\.github\/workflows\/[^/]*deploy[^/]*$/i;
const ONE_POINT_OH = /\bv?1\.0\.0\b/;

const any = (holds) => (records) => (records.some(holds) ? 1 : 0);
const reached = (value, threshold) => (value >= threshold ? 1 : 0);
const isScored = (record) => record.status === "scored";
const anyCommit = (holds) => any((record) => isScored(record) && commitDates(record).some(holds));
const totalXp = (records) => sum(scored(records).map((record) => record.xp));
const anySubject = (holds) => any((record) => isScored(record) && commitsOf(record).some((commit) => holds(commit.subject ?? "")));
const on = (month, date) => anyCommit((when) => when.getMonth() === month - 1 && when.getDate() === date);
// Landings of consecutive scored units, in milliseconds apart.
const gaps = (records) => {
  const times = scored(records).map((record) => landedDate(record).getTime());
  return times.slice(1).map((time, index) => time - times[index]);
};
function shouting(subject) {
  const letters = subject.replace(/[^\p{L}]/gu, "");
  return letters.length >= 8 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export const SECRET = [
  {
    id: "ctrl-z", name: "Ctrl+Z", description: "one of your units was reverted",
    value: any((record) => record.status === "reverted"),
  },
  {
    id: "revisionist", name: "Revisionist", description: "a force push rewrote one of your units out of history",
    value: any((record) => record.status === "superseded"),
  },
  {
    id: "yolo-friday", name: "YOLO Friday", description: "shipped on a Friday after 5 pm",
    value: any((record) => isScored(record) && landedDate(record).getDay() === 5 && landedDate(record).getHours() >= 17),
  },
  {
    id: "friday-13", name: "Paraskevidekatriaphobia", description: "committed on Friday the 13th",
    value: anyCommit((date) => date.getDay() === 5 && date.getDate() === 13),
  },
  {
    id: "three-am", name: "3 AM Thoughts", description: "committed between 3 and 4 in the morning",
    value: anyCommit((date) => date.getHours() === 3),
  },
  {
    id: "new-year", name: "Happy New Year", description: "committed on New Year's Day",
    value: anyCommit((date) => date.getMonth() === 0 && date.getDate() === 1),
  },
  {
    id: "christmas", name: "Silent Night", description: "committed on Christmas Day",
    value: anyCommit((date) => date.getMonth() === 11 && date.getDate() === 25),
  },
  {
    id: "thanos-snap", name: "Thanos Snap", description: "deleted 1,000+ counted lines in one unit, adding less than a tenth of that",
    value: any((record) => {
      if (!isScored(record)) return false;
      const { added, deleted } = countedChange(record);
      return deleted >= 1000 && added * 10 < deleted;
    }),
  },
  {
    id: "monolith", name: "Monolith", description: "one unit of 3,000+ counted lines",
    value: any((record) => {
      if (!isScored(record)) return false;
      const { added, deleted } = countedChange(record);
      return added + deleted >= 3000;
    }),
  },
  { id: "leet", name: "1337", description: "1,337 XP in total", value: (records) => reached(totalXp(records), 1337) },
  {
    id: "the-answer", name: "The Answer", description: "level 42, the answer to life, the universe and everything",
    value: (records) => reached(levelFor(totalXp(records)).level, 42),
  },
  {
    id: "comeback", name: "The Comeback", description: `back after ${COMEBACK_DAYS}+ days without a unit`,
    value: (records) => (gaps(records).some((gap) => gap >= COMEBACK_DAYS * DAY_MS) ? 1 : 0),
  },
  {
    id: "very-descriptive", name: "Very Descriptive", description: "a commit message of one lazy word",
    value: anySubject((subject) => LAZY_SUBJECT.test(subject.trim())),
  },
  {
    id: "novelist", name: "Novelist", description: "a commit message of 1,000+ characters",
    value: any((record) => isScored(record) && commitsOf(record).some((commit) => `${commit.subject ?? ""}\n${commit.body ?? ""}`.length >= 1000)),
  },
  {
    id: "typo-lord", name: "Typo Lord", description: "5 units too small for the judge",
    value: (records) => reached(count(scored(records), (record) => record.result?.method === "rule"), 5),
  },
  {
    id: "for-nothing", name: "All That for Nothing", description: "a judged unit worth 0 XP",
    value: any((record) => judged([record]).length === 1 && record.xp === 0),
  },
  {
    id: "big-spender", name: "Big Spender", description: "$10 spent on the judge",
    // Every judged unit cost the judge, whatever became of it; a hundredth of a cent absorbs float sums.
    value: (records) => reached(sum(records.map((record) => record.result?.costUsd ?? 0)), 10 - 1e-4),
  },
  {
    id: "meta", name: "Inception", description: "scored a unit of Evolo itself",
    value: any((record) => isScored(record) && record.repo.split("/")[1]?.toLowerCase() === "evolo"),
  },
  { id: "halloween", name: "Spooky Code", description: "committed on Halloween", value: on(10, 31) },
  { id: "pi-day", name: "3.14159", description: "committed on Pi Day", value: on(3, 14) },
  { id: "valentine", name: "True Love", description: "spent Valentine's Day with your code", value: on(2, 14) },
  {
    id: "cinderella", name: "Cinderella", description: "committed at the stroke of midnight",
    value: anyCommit((date) => date.getHours() === 0 && date.getMinutes() === 0),
  },
  { id: "century", name: "Century", description: "a unit worth exactly 100 XP", value: any((record) => isScored(record) && record.xp === 100) },
  {
    id: "speedrun", name: "Speedrun", description: "two units landed within 5 minutes",
    value: (records) => (gaps(records).some((gap) => gap <= SPEEDRUN_MS) ? 1 : 0),
  },
  {
    id: "prompt-engineer", name: "Prompt Engineer", description: "5 units the judge found mostly generated",
    value: (records) => reached(count(judged(records), (record) => (record.result.evaluation.flags ?? []).includes("mostly_generated_code")), 5),
  },
  { id: "emoji", name: "Emoji Artist", description: "an emoji in a commit subject", value: anySubject((subject) => PICTOGRAPH.test(subject)) },
  { id: "caps-lock", name: "CAPS LOCK", description: "A COMMIT SUBJECT IN CAPITALS", value: anySubject(shouting) },
  { id: "undo-the-undo", name: "Undo the Undo", description: "reverted a revert", value: anySubject((subject) => subject.startsWith('Revert "Revert ')) },
  {
    id: "shipper", name: "Shipper", description: "a release commit or a commit subject with a version",
    value: anySubject((subject) => RELEASE_SUBJECT.test(subject) || SEMVER.test(subject)),
  },
  {
    id: "to-production", name: "To Production", description: "a deploy commit or a deploy workflow",
    value: any((record) => isScored(record) && (
      commitsOf(record).some((commit) => DEPLOY_SUBJECT.test((commit.subject ?? "").trim()))
      || filesOf(record).some((file) => DEPLOY_WORKFLOW.test(file.path ?? ""))
    )),
  },
  {
    id: "one-point-oh", name: "One Point Oh", description: "a commit subject with version 1.0.0",
    value: anySubject((subject) => ONE_POINT_OH.test(subject)),
  },
].map((rule) => ({ ...rule, tiers: [1], hidden: true }));
