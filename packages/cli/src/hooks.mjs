// Installs and removes Evolo's git `pre-push` hook, keeping any hook the repository already had.
// Git has no post-push hook, so this one only records what is about to be pushed; the worker checks that it landed.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "./facts.mjs";
import { quoteCommand } from "./platform.mjs";

const MARKER = "# Installed by evolo.";
const CHAINED = "pre-push.evolo-chained";

// `command` is the argv that runs the Evolo CLI, e.g. [node, ".../bin/evolo.mjs"].
// Git gives the refs on stdin, which can be read only once, so the script keeps them and hands them to both.
// Evolo's part never fails the push: only the previous hook can stop it, as it could before.
export function hookScript(command) {
  const evolo = quoteCommand(command);
  return `#!/bin/sh
${MARKER} \`evolo uninstall\` removes it; the previous pre-push hook, if any, is ${CHAINED}.
input=$(cat)
[ -n "$input" ] && input="$input
"
if [ -z "$EVOLO_JUDGE" ]; then
  printf '%s' "$input" | ${evolo} enqueue push --pusher "$PPID" -- "$@" >/dev/null 2>&1 || true
fi
chained="$(dirname "$0")/${CHAINED}"
if [ -x "$chained" ]; then
  printf '%s' "$input" | "$chained" "$@"
  exit $?
fi
exit 0
`;
}

// The hooks directory git really uses, honouring core.hooksPath (husky) and worktrees.
function hooksDir(repoDir) {
  return resolve(repoDir, git(repoDir, ["rev-parse", "--git-path", "hooks"]).trim());
}

const isEvoloHook = (path) => existsSync(path) && readFileSync(path, "utf8").includes(MARKER);

// Returns what was done, for `evolo init` to print.
export function installHook(repoDir, command) {
  const dir = hooksDir(repoDir);
  const hook = join(dir, "pre-push");
  const chained = join(dir, CHAINED);
  mkdirSync(dir, { recursive: true });
  let note = `installed ${hook}`;
  if (isEvoloHook(hook)) {
    note = `updated ${hook}`;
  } else if (existsSync(hook)) {
    if (existsSync(chained)) throw new Error(`both ${hook} and ${chained} exist; move one of them away first`);
    renameSync(hook, chained);
    note += `, keeping the previous hook as ${CHAINED}`;
  }
  writeFileSync(hook, hookScript(command));
  chmodSync(hook, 0o755);
  return note;
}

export function uninstallHook(repoDir) {
  const dir = hooksDir(repoDir);
  const hook = join(dir, "pre-push");
  const chained = join(dir, CHAINED);
  if (!isEvoloHook(hook)) return `no evolo hook in ${dir}`;
  rmSync(hook);
  if (!existsSync(chained)) return `removed ${hook}`;
  renameSync(chained, hook);
  return `removed ${hook} and restored the previous hook`;
}
