import assert from "node:assert/strict";
import { test } from "node:test";
import { remoteFor } from "./github.mjs";

// Output of `git remote -v` for a clone of a fork, with the original repository added as `upstream`.
const forkClone = [
  "origin\tgit@github.com:me/lightrag.git (fetch)",
  "origin\tgit@github.com:me/lightrag.git (push)",
  "upstream\thttps://github.com/Owner/LightRAG (fetch)",
  "upstream\thttps://github.com/Owner/LightRAG (push)",
  "mirror\thttps://gitlab.com/owner/lightrag (fetch)",
].join("\n");

test("remoteFor picks the remote that points at the GitHub repository, whatever its name or URL form", () => {
  assert.equal(remoteFor(forkClone, "https://github.com/owner/lightrag"), "upstream");
  assert.equal(remoteFor(forkClone, "https://github.com/me/lightrag"), "origin");
  assert.equal(remoteFor("origin\tssh://git@github.com:22/me/x.git (fetch)", "https://github.com/me/x"), "origin");
  // Same owner and name on another host is a different repository.
  assert.equal(remoteFor(["mirror\thttps://gitlab.com/me/x (fetch)", "origin\tgit@github.com:me/x (fetch)"].join("\n"), "https://github.com/me/x"), "origin");
});

test("remoteFor fails clearly when no remote points at the repository", () => {
  assert.throws(() => remoteFor(forkClone, "https://github.com/someone/else"), /no git remote points at https:\/\/github.com\/someone\/else/);
});
