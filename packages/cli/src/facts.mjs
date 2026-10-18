// Collects measured, trusted facts about a commit and its repository.
// Nothing here uses AI: these numbers are the ground truth the judge must not contradict.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README_EXCERPT_LINES = 60;

export function git(repoDir, args) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

function parseNumstat(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, path] = line.split("\t");
      const isBinary = added === "-";
      return {
        path,
        class: classifyFile(path),
        additions: isBinary ? 0 : Number(added),
        deletions: isBinary ? 0 : Number(deleted),
        binary: isBinary,
      };
    });
}

function sumLinesByClass(files) {
  return files.reduce((totals, file) => {
    const lines = file.additions + file.deletions;
    return { ...totals, [file.class]: (totals[file.class] ?? 0) + lines };
  }, {});
}

export function collectCommitFacts(repoDir, sha) {
  const [fullSha, parent, author, date, subject, ...bodyLines] = git(repoDir, [
    "show", "-s", "--format=%H%n%P%n%an <%ae>%n%aI%n%s%n%b", sha,
  ]).split("\n");
  const files = parseNumstat(git(repoDir, ["show", "--numstat", "--format=", sha]));
  const linesByClass = sumLinesByClass(files);
  const countedLines = files
    .filter((file) => COUNTED_CLASSES.has(file.class))
    .reduce((total, file) => total + file.additions + file.deletions, 0);
  const revertedBy = git(repoDir, ["log", "--format=%H", `--grep=This reverts commit ${fullSha}`, "--all"])
    .split("\n")
    .filter(Boolean);
  const repoHasTests = git(repoDir, ["ls-files", "-z"]).split("\0").some((path) => classifyFile(path) === "test");

  return {
    kind: "commit",
    sha: fullSha,
    parent: parent.split(" ")[0] || null,
    author,
    date,
    subject,
    body: bodyLines.join("\n").trim(),
    files,
    totals: {
      files: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      countedLines,
      linesByClass,
    },
    testsTouched: files.some((file) => file.class === "test"),
    repoHasTests,
    revertedBy,
  };
}

function moduleOf(path) {
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length === 2 ? parts[0] : ".";
}

function countLines(text) {
  return text === "" ? 0 : text.split("\n").length;
}

// Describes the repository as it was at `checkoutDir` (a worktree at the evaluated commit).
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
