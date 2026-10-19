// Collects measured, trusted facts about a contribution (a push or a merged PR) and its repository.
// Nothing here uses AI: these numbers are the ground truth the judge must not contradict.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README_EXCERPT_LINES = 60;

// `timeout` (ms) bounds calls that talk to a remote, which can hang on a dead network.
export function git(repoDir, args, { timeout } = {}) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout });
}

const FILE_CLASS_RULES = [
  ["lockfile", /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum)$/],
  ["generated", /(^|\/)(dist|build|vendor|node_modules|__generated__)\/|\.min\.(js|css)$|\.(snap|map)$/],
  ["fixture", /(^|\/)(testdata|fixtures|__fixtures__)\//],
  ["test", /(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]+\.py$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$/],
  ["docs", /\.(md|mdx|rst|txt)$|(^|\/)docs\//i],
  ["config", /(^|\/)\.[^/]+$|\.(toml|ya?ml|json|jsonc|ini|conf|cfg|env|example|service)$|(^|\/)systemd\//],
];

export function classifyFile(path) {
  const match = FILE_CLASS_RULES.find(([, pattern]) => pattern.test(path));
  return match ? match[0] : "source";
}

// Lines in these classes count toward contribution size; the rest are excluded from every calculation.
export const COUNTED_CLASSES = new Set(["source", "test"]);

// Parses `git diff --numstat -z`. A rename is "added\tdeleted\t" followed by the old and new path as separate fields,
// and is reported under its new path so it can be classified and cited as evidence.
function parseNumstat(output) {
  const fields = output.split("\0");
  const files = [];
  for (let index = 0; index < fields.length; index += 1) {
    if (!fields[index]) continue;
    const [added, deleted, inlinePath] = fields[index].split("\t");
    if (inlinePath === "") index += 2;
    const path = inlinePath === "" ? fields[index] : inlinePath;
    const isBinary = added === "-";
    files.push({
      path,
      class: classifyFile(path),
      additions: isBinary ? 0 : Number(added),
      deletions: isBinary ? 0 : Number(deleted),
      binary: isBinary,
    });
  }
  return files;
}

function sumLinesByClass(files) {
  return files.reduce((totals, file) => {
    const lines = file.additions + file.deletions;
    return { ...totals, [file.class]: (totals[file.class] ?? 0) + lines };
  }, {});
}

const FIELD = "\x1f";
const RECORD = "\x1e";

// The diff base of a unit whose range starts at the root: the empty tree, so the root commit is all additions.
export function diffBase(repoDir, base) {
  return base ?? git(repoDir, ["hash-object", "-t", "tree", "/dev/null"]).trim();
}

function rangeArgs(base, tip) {
  return base ? [`${base}..${tip}`] : [tip];
}

function listCommits(repoDir, base, tip) {
  const format = ["%H", "%an <%ae>", "%aI", "%s", "%b"].join("%x1f") + "%x1e";
  return git(repoDir, ["log", "--no-merges", "--reverse", `--format=${format}`, ...rangeArgs(base, tip)])
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, author, date, subject, body] = record.split(FIELD);
      return { sha, author, date, subject, body: body.trim() };
    });
}

// Maps each reverted commit to the commits that revert it, from one scan of every ref.
export function findReverts(repoDir) {
  const reverts = new Map();
  const log = git(repoDir, ["log", "--all", "--grep=This reverts commit", `--format=%H${FIELD}%B${RECORD}`]);
  for (const record of log.split(RECORD).filter((entry) => entry.trim())) {
    const [sha, message] = record.trim().split(FIELD);
    for (const [, reverted] of message.matchAll(/This reverts commit ([0-9a-f]{40,64})/g)) {
      reverts.set(reverted, [...(reverts.get(reverted) ?? []), sha]);
    }
  }
  return reverts;
}

// A unit is reverted when its PR's merge commit is, or every one of its commits is.
// Partial reverts are recorded per commit but do not change XP yet (docs/auto-scoring.md section 4).
export function isReverted(commitShas, mergeCommit, reverts) {
  if (mergeCommit && reverts.has(mergeCommit)) return true;
  return commitShas.length > 0 && commitShas.every((sha) => reverts.has(sha));
}

// Sums each commit's own changes per file, for a unit whose commits are not a contiguous range of the user's work.
// A line changed by two of the commits is counted twice: the price of leaving the other commits out.
function perCommitFiles(repoDir, shas) {
  const byPath = new Map();
  for (const sha of shas) {
    for (const file of parseNumstat(git(repoDir, ["show", "--numstat", "-z", "--format=", sha]))) {
      const previous = byPath.get(file.path);
      const merged = previous && {
        ...previous,
        additions: previous.additions + file.additions,
        deletions: previous.deletions + file.deletions,
        binary: previous.binary || file.binary,
      };
      byPath.set(file.path, merged ?? file);
    }
  }
  return [...byPath.values()];
}

// Measures a unit from units.mjs, the same way changeDiff shows it to the judge:
// - "net": the change from `base` to `tip`, so a file added and removed again inside the unit does not count;
// - "per-commit": when `unit.selected` names the only commits that count, each of them on its own.
export function collectChangeFacts(repoDir, unit) {
  const { kind, id, base, tip, excluded = [], selected, pr = null } = unit;
  const diffMode = selected ? "per-commit" : "net";
  const reverts = findReverts(repoDir);
  const commits = listCommits(repoDir, base, tip)
    .filter((commit) => !selected || selected.includes(commit.sha))
    .map((commit) => ({ ...commit, revertedBy: reverts.get(commit.sha) ?? [] }));
  const files = selected
    ? perCommitFiles(repoDir, selected)
    : parseNumstat(git(repoDir, ["diff", "--numstat", "-z", diffBase(repoDir, base), tip]));
  const countedLines = files
    .filter((file) => COUNTED_CLASSES.has(file.class))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
  const repoHasTests = git(repoDir, ["ls-files", "-z"]).split("\0").some((path) => classifyFile(path) === "test");
  const prFacts = pr && { ...pr, revertedBy: (pr.mergeCommit && reverts.get(pr.mergeCommit)) ?? [] };
  const reverted = isReverted(commits.map((commit) => commit.sha), prFacts?.mergeCommit, reverts);

  return {
    kind,
    id,
    base,
    tip,
    pr: prFacts,
    diffMode,
    commits,
    excluded,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      countedLines,
      linesByClass: sumLinesByClass(files),
    },
    testsTouched: files.some((file) => file.class === "test"),
    repoHasTests,
    reverted,
  };
}

// The patch the judge reads, matching what collectChangeFacts measured.
export function changeDiff(repoDir, facts) {
  if (facts.diffMode === "net") return git(repoDir, ["diff", "--patch", diffBase(repoDir, facts.base), facts.tip]);
  return facts.commits.map((commit) => git(repoDir, ["show", "--patch", "--format=commit %H%n%n    %s%n", commit.sha])).join("\n");
}

function moduleOf(path) {
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : ".";
}

function countLines(text) {
  return text === "" ? 0 : text.split("\n").length;
}

// Describes the repository as it was at `checkoutDir` (a worktree at the unit's tip).
export function collectRepoContext(checkoutDir, { name, url, stars, isOwnRepo }) {
  const paths = git(checkoutDir, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const modules = paths.reduce((acc, path) => {
    const fileClass = classifyFile(path);
    const key = moduleOf(path);
    const previous = acc[key] ?? { files: 0, sourceLines: 0, testLines: 0 };
    const lines = COUNTED_CLASSES.has(fileClass) ? countLines(readFileSync(join(checkoutDir, path), "utf8")) : 0;
    return {
      ...acc,
      [key]: {
        files: previous.files + 1,
        sourceLines: previous.sourceLines + (fileClass === "source" ? lines : 0),
        testLines: previous.testLines + (fileClass === "test" ? lines : 0),
      },
    };
  }, {});
  const readmePath = paths.find((path) => /^readme\.md$/i.test(path));
  const readmeExcerpt = readmePath
    ? readFileSync(join(checkoutDir, readmePath), "utf8").split("\n").slice(0, README_EXCERPT_LINES).join("\n")
    : "";

  return {
    name,
    url,
    stars,
    isOwnRepo,
    totalFiles: paths.length,
    totalSourceLines: Object.values(modules).reduce((total, mod) => total + mod.sourceLines, 0),
    modules,
    readmeExcerpt,
  };
}
