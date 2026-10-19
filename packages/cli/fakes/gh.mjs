// Stand-in for the `gh` CLI in end-to-end tests. Answers the calls github.mjs makes from the JSON file in $FAKE_GH:
// { repo, login, prs: [gh pr view objects plus mergedAt], commitPrs: { sha: [{ number, merged, baseRefOid }] }, down? }.
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
      { associatedPullRequests: { nodes: state.commitPrs[sha] ?? [] } },
    ]),
  );
  print({ data: { repository } });
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
