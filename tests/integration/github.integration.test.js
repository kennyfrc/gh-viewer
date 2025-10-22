import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createViewer,
  parseRepo,
} from "../../dist/index.js";

const token = process.env.GITHUB_TOKEN;
const repoSlug = "octocat/Hello-World";
const repo = parseRepo(repoSlug);

const requiresToken = !token;

const viewer = createViewer({ token });

const integration = requiresToken
  ? (name, fn) => test.skip(`${name} (requires GITHUB_TOKEN)`, fn)
  : test;

integration("integration: listPath against octocat/Hello-World", async () => {
  const listing = await viewer.listPath(repo, ".", { limit: 5 });
  assert.ok(listing.entries.length > 0);
  assert.ok(listing.entries.some((entry) => entry.name === "README" || entry.name === "README.md"));
});

test("integration suite requirements", (t) => {
  if (requiresToken) {
    t.skip("Set GITHUB_TOKEN to run GitHub integration tests");
  }
});

integration("integration: readFile with line numbers", async () => {
  const read = await viewer.readFile(repo, "README", {
    range: { start: 1, end: 5 },
    includeLineNumbers: true,
  });
  assert.ok(read.lines.length > 0);
  assert.ok(/\d+\s/.test(read.lines[0] ?? ""));
});

integration("integration: globFiles (README)", async () => {
  const glob = await viewer.globFiles(repo, "README*");
  assert.ok(glob.matches.some((match) => match.startsWith("README")));
});

integration("integration: searchCode basic pattern", async () => {
  const results = await viewer.searchCode(repo, {
    pattern: "Hello World!",
    limit: 5,
  });
  assert.ok(results.length > 0);
  assert.ok(results.some((item) => item.path.includes("README")));
});

integration("integration: searchCommits author filter", async () => {
  const commits = await viewer.searchCommits(repo, {
    author: "octocat",
    limit: 5,
  });
  assert.ok(commits.length > 0);
});

integration("integration: compareCommits main...master", async () => {
  const result = await viewer.compareCommits(repo, "master", "master", {
    includePatches: false,
  });
  assert.equal(result.files.length, 0);
});
