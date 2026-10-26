# Evolo

Scores your GitHub contributions with an AI judge and a deterministic XP formula. It runs entirely on your machine:
no server, no account.

Every push to your default branch, and every PR of yours that gets merged, counts as one contribution. An AI judge
grades it against a rubric; every number — XP, level, achievements, stats — is computed by code. The AI only judges,
the code does the math, so any number can be recomputed from stored data without calling the judge again.

![The dashboard's Overview screen](https://raw.githubusercontent.com/hiinguyen/Evolo/main/docs/images/overview.png)

## Install

```bash
npm install -g evolo
```

Linux, macOS and Windows. Node.js 20 or newer. The judge needs one of:

- [Claude Code](https://claude.com/claude-code) (`claude`), signed in — the default judge;
- [opencode](https://opencode.ai) (`opencode`), signed in — with `--judge opencode`.

Also needs `git` and the GitHub CLI `gh`, signed in with `gh auth login`.

## Quick start

```bash
cd ~/code/my-project     # a clone of one of your GitHub repos
evolo init               # registers the clone and installs a pre-push hook
evolo status             # level, XP, the queue, the latest scores
evolo dashboard          # one page of scores, analytics, achievements and reviews
```

From then on every push to the default branch is scored in the background, and so is every PR of yours that gets
merged.

## Commands

| Command | Meaning |
|---|---|
| `evolo init` | Register a repo and install the `pre-push` hook |
| `evolo status` | Level, rank, XP, the queue, today's judge spending, the latest scores |
| `evolo stats [week\|month\|quarter]` | Analytics of a calendar period against the previous one, plus the workday streak |
| `evolo achievements` | Every achievement's tier and progress |
| `evolo why [<commit>\|#<pr>]` | How a unit was scored: rubric, evidence, formula |
| `evolo review` | A code review of a unit by a separate judge |
| `evolo report [week\|month\|quarter]` | A performance review of a period, every citation checked by code |
| `evolo dashboard` | Write the dashboard page and open it |
| `evolo claude install` | The `/evolo` skill, a session sync hook and a status line in Claude Code |
| `evolo config` | Read and change the settings in `~/.evolo/config.json` |

Full documentation, design notes and the test suite: **https://github.com/hiinguyen/Evolo**

## Notes

- No dependencies and no build step: the package is plain Node.js modules.
- Desktop notifications use `notify-send` on Linux, `osascript` on macOS and a PowerShell balloon on Windows; a
  machine without one still scores, it just does not announce it.
- On Windows the judge must be a native executable: the `.cmd` shim that npm installs cannot carry Evolo's multi-line
  prompt. Install Claude Code with its PowerShell installer, not through npm.

## License

MIT
