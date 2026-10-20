// Stand-in for the `gh` CLI in end-to-end tests. Answers the calls github.mjs makes from the JSON file in $FAKE_GH:
// { repo, login, prs: [gh pr view objects plus mergedAt and, for the signals, author, reviews, commitDates, closingIssues],
//   commitPrs: { sha: [{ number, merged, baseRefOid }] }, checks: { sha: CI state },
//   issues: { number: { state, labels, pr, closedBy } }, down? }.
// `down: true` fails every call, as when the network is gone.
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(process.env.FAKE_GH, "utf8"));
const args = process.argv.slice(2);
const print = (value) => process.stdout.write(typeof value === "string" ? `${value}\n` : JSON.stringify(value));
const call = args.slice(0, 2).join(" ");

if (state.down) {
  process.stderr.write("error connecting to api.github.com\n");
  process.exit(1);
} else if (call === "repo view") {
  print(state.repo);
} else if (call === "api user") {
  print(state.login);
} else if (call === "api graphql") {
  const query = args.find((arg) => arg.startsWith("query=")) ?? "";
  const repository = Object.fromEntries(
    [...query.matchAll(/(c\d+): object\(oid: "([0-9a-f]+)"\)/g)].map(([, alias, sha]) => [
      alias,
      {
        associatedPullRequests: { nodes: state.commitPrs[sha] ?? [] },
        statusCheckRollup: state.checks?.[sha] ? { state: state.checks[sha] } : null,
      },
    ]),
  );
  const number = /pr: pullRequest\(number: (\d+)\)/.exec(query)?.[1];
  const pr = number && state.prs.find((candidate) => candidate.number === Number(number));
  if (pr) {
    repository.pr = {
      author: { login: pr.author ?? state.login },
      reviews: { nodes: (pr.reviews ?? []).map(({ author, ...review }) => ({ ...review, author: { login: author } })) },
      commits: { nodes: (pr.commitDates ?? []).map((committedDate) => ({ commit: { committedDate } })) },
      closingIssuesReferences: {
        nodes: (pr.closingIssues ?? []).map((issue) => ({ number: issue.number, labels: { nodes: issue.labels.map((name) => ({ name })) } })),
      },
    };
  }
  print({ data: { repository } });
} else if (args[0] === "api" && /^repos\/\{owner\}\/\{repo\}\/issues\/\d+/.test(args.find((arg) => arg.startsWith("repos/")) ?? "")) {
  const path = args.find((arg) => arg.startsWith("repos/"));
  const issue = state.issues?.[/issues\/(\d+)/.exec(path)[1]];
  if (!issue) {
    process.stderr.write("gh: Not Found (HTTP 404)\n");
    process.exit(1);
  }
  // The answers to the --jq filters github.mjs passes: the issue, or the commit of each time it was closed.
  if (path.includes("/events")) print(issue.state === "closed" ? `${issue.closedBy ?? ""}` : "");
  else print({ state: issue.state, labels: issue.labels, pr: Boolean(issue.pr) });
} else if (call === "pr list") {
  print(state.prs.filter((pr) => pr.state === "MERGED").map(({ number, mergedAt }) => ({ number, mergedAt })));
} else if (call === "pr view") {
  const pr = state.prs.find((candidate) => candidate.number === Number(args[2]));
  if (!pr) {
    process.stderr.write(`no pull requests found for ${args[2]}\n`);
    process.exit(1);
  }
  print(pr);
} else {
  process.stderr.write(`fake gh: unsupported call: ${args.join(" ")}\n`);
  process.exit(1);
}
