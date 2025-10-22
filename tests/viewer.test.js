import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createViewer,
  parseRepo,
} from "../dist/index.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function base64Content(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function createMockFetch(routes, log) {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    log?.push({ method, url });
    for (const route of routes) {
      if (typeof route.match === "function") {
        if (route.match(method, url)) {
          return route.reply(url, init);
        }
      } else if (route.match instanceof RegExp) {
        if (route.match.test(url)) {
          return route.reply(url, init);
        }
      } else if (route.match === url) {
        return route.reply(url, init);
      }
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

test("searchRepositories prioritises accessible repos and falls back to public search", async () => {
  const calls = [];
  const fetchImpl = createMockFetch(
    [
      {
        match: (method, url) =>
          method === "GET" &&
          url.startsWith(
            "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member"
          ),
        reply: () =>
          jsonResponse([
            {
              full_name: "acme/internal-project",
              name: "internal-project",
              stargazers_count: 50,
              forks_count: 5,
              language: "TypeScript",
              description: "Internal tools",
              default_branch: "main",
              topics: ["internal"],
            },
            {
              full_name: "acme/misc",
              name: "misc",
              stargazers_count: 1,
              forks_count: 0,
              language: "TypeScript",
              description: "Misc repo",
              default_branch: "main",
              topics: [],
            },
          ]),
      },
      {
        match: (method, url) =>
          method === "GET" && url.startsWith("https://api.github.com/search/repositories"),
        reply: () =>
          jsonResponse({
            items: [
              {
                full_name: "public/project-template",
                name: "project-template",
                stargazers_count: 320,
                forks_count: 20,
                visibility: "public",
                language: "TypeScript",
                description: "Project template",
                default_branch: "main",
                topics: ["template"],
              },
            ],
          }),
      },
    ],
    calls,
  );

  const viewer = createViewer({ fetchImpl, token: "fake-token" });
  const repos = await viewer.searchRepositories({ pattern: "project", limit: 3 });

  assert.equal(repos.length, 2);
  assert.equal(repos[0].fullName, "acme/internal-project");
  assert.equal(repos[1].fullName, "public/project-template");
  assert.ok(calls.some((call) => call.url.startsWith("https://api.github.com/search/repositories")));
});

test("listPath respects limit and offset while returning structured entries", async () => {
  const repo = parseRepo("acme/example");
  const fetchImpl = createMockFetch([
    {
      match: (method, url) =>
        method === "GET" &&
        url ===
          "https://api.github.com/repos/acme/example/contents/",
      reply: () =>
        jsonResponse([
          { type: "dir", name: "src", sha: "sha-src" },
          { type: "file", name: "README.md", sha: "sha-readme", size: 120 },
          { type: "symlink", name: "link", target: "docs", sha: "sha-link" },
        ]),
    },
  ]);

  const viewer = createViewer({ fetchImpl });
  const result = await viewer.listPath(repo, ".", { limit: 1, offset: 1 });

  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0], {
    name: "README.md",
    type: "file",
    size: 120,
    sha: "sha-readme",
  });
});

test("readFile can include prefixed line numbers", async () => {
  const repo = parseRepo("acme/example");
  const fileContent = base64Content("first line\nsecond line\nthird line\n");
  const fetchImpl = createMockFetch([
    {
      match: (method, url) =>
        method === "GET" &&
        url ===
          "https://api.github.com/repos/acme/example/contents/file.txt",
      reply: () =>
        jsonResponse({
          type: "file",
          name: "file.txt",
          content: fileContent,
          encoding: "base64",
        }),
    },
  ]);

  const viewer = createViewer({ fetchImpl });
  const result = await viewer.readFile(repo, "file.txt", {
    range: { start: 2, end: 3 },
    includeLineNumbers: true,
  });

  assert.deepEqual(result.lines, ["     2 second line", "     3 third line"]);
});

test("searchCode returns contextual snippets using blob lookups", async () => {
  const repo = parseRepo("acme/example");
  const calls = [];
  const fetchImpl = createMockFetch(
    [
      {
        match: (method, url) =>
          method === "GET" && url.startsWith("https://api.github.com/search/code"),
        reply: () =>
          jsonResponse({
            items: [
              {
                path: "src/index.ts",
                sha: "abc123",
                html_url: "https://github.com/acme/example/blob/main/src/index.ts#L1",
                repository: {
                  full_name: "acme/example",
                  name: "example",
                },
                text_matches: [
                  {
                    fragment: 'export function greet() {\n  return "hi";\n}',
                    matches: [{ text: "greet" }],
                  },
                ],
              },
            ],
          }),
      },
      {
        match: (method, url) =>
          method === "GET" &&
          url ===
            "https://api.github.com/repos/acme/example/git/blobs/abc123",
        reply: () =>
          jsonResponse({
            content: base64Content('export function greet() {\n  return "hi";\n}\n'),
            encoding: "base64",
          }),
      },
    ],
    calls,
  );

  const viewer = createViewer({ fetchImpl });
  const results = await viewer.searchCode(repo, {
    pattern: "greet",
    limit: 5,
  });

  assert.equal(results.length, 1);
  const [match] = results;
  assert.equal(match.path, "src/index.ts");
  assert.ok(match.snippets.length >= 1);
  assert.ok(
    match.snippets.some((snippet) => snippet.lines.some((line) => line.includes("greet")))
  );
  assert.ok(calls.some((call) => call.url.includes("git/blobs/abc123")));
});

test("searchCommits maps GitHub search payloads", async () => {
  const repo = parseRepo("acme/example");
  const fetchImpl = createMockFetch([
    {
      match: (method, url) =>
        method === "GET" && url.startsWith("https://api.github.com/search/commits"),
      reply: () =>
        jsonResponse({
          items: [
            {
              sha: "abcdef123456",
              html_url: "https://github.com/acme/example/commit/abcdef123456",
              commit: {
                message: "Fix bug",
                author: {
                  name: "Alex",
                  email: "alex@example.com",
                  date: "2024-05-01T00:00:00Z",
                },
              },
              stats: {
                additions: 10,
                deletions: 2,
                total: 1,
              },
            },
          ],
        }),
    },
  ]);

  const viewer = createViewer({ fetchImpl });
  const commits = await viewer.searchCommits(repo, {
    query: "bug",
    limit: 5,
  });

  assert.equal(commits.length, 1);
  const commit = commits[0];
  assert.ok(commit);
  assert.equal(commit.sha, "abcdef123456");
  assert.equal(commit.authorName, "Alex");
  assert.equal(commit.stats?.additions, 10);
});

test("compareCommits returns diff metadata with optional patches", async () => {
  const repo = parseRepo("acme/example");
  const fetchImpl = createMockFetch([
    {
      match: (method, url) =>
        method === "GET" &&
        url ===
          "https://api.github.com/repos/acme/example/compare/main...feature",
      reply: () =>
        jsonResponse({
          ahead_by: 2,
          behind_by: 0,
          total_commits: 2,
          files: [
            {
              filename: "src/index.ts",
              status: "modified",
              additions: 5,
              deletions: 1,
              changes: 6,
              patch: "@@ -1,1 +1,1 @@",
            },
          ],
        }),
    },
  ]);

  const viewer = createViewer({ fetchImpl });
  const result = await viewer.compareCommits(repo, "main", "feature", {
    includePatches: true,
  });

  assert.equal(result.aheadBy, 2);
  assert.equal(result.files.length, 1);
  const fileChange = result.files[0];
  assert.ok(fileChange);
  assert.equal(fileChange.patch, "@@ -1,1 +1,1 @@");
});
