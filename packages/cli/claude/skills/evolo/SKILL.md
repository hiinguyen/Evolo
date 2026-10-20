---
name: evolo
description: Show the user's Evolo XP, explain how a push or PR was scored, review a push or PR, or retry failed scoring.
argument-hint: "[why <commit|#pr|unit id>] | [review <commit|#pr|unit id> [--again]] | [retry]"
disable-model-invocation: true
allowed-tools: Bash(evolo status:*), Bash(evolo why:*), Bash(evolo review:*), Bash(evolo retry:*)
---

# Evolo

Evolo scores the user's pushes to the default branch and merged PRs in the background, with a separate judge.
This skill only reads what Evolo has recorded and runs the `evolo` CLI.
Never score, review or re-judge a contribution yourself, and never change code to raise a score: the scores come from Evolo's judge alone.

Arguments: `$ARGUMENTS`

## What to run

- No arguments: run `evolo status`.
  Report the level, total XP, XP today and over the last 7 days, anything queued or failing, and the latest units with their one-line reasons.
- `why <ref>`: run `evolo why <ref>`, where `<ref>` is a commit, `#<pr number>` or a unit id such as `push-89fd4e3-8c68e65`.
  Without a ref it explains the latest unit.
  Explain which rubric scores drove the XP, quoting the judge's reasons and evidence, and how the formula line turned them into XP.
- `review <ref>`: run `evolo review <ref>` (add `--again` only when the user asks for a new review).
  It shows the saved review, or has Evolo's judge write one first, which takes up to a minute and costs a few cents.
  Report the overview, then the findings from most to least severe with their locations and suggested fixes, then strengths and improvements.
  Do not start fixing the findings unless the user asks.
- `retry`: run `evolo retry`, then report what it queued.
  Scoring runs in the background, so tell the user to check `/evolo` again in a minute.

## How to answer

- Answer in the user's language, briefly.
- Report what the output says; do not add scores, guesses or praise of your own.
- When a unit is `failed`, give the reason from the output and suggest `/evolo retry`.
