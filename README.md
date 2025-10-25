# gh-viewer

`gh-viewer` lets you explore GitHub repositories from the command line using the GitHub REST API. It focuses on fast repository discovery and inspection:

- list directories within a repo (`--list`)
- read file contents with optional line ranges (`--read`)
- run glob patterns against the repository tree (`--glob`)
- search accessible and public repositories (`--search-repos`)
- search code within a repository (`--search-code`)
- search commit history (`--commit-search`)
- compare refs with diff stats (`--diff`)

## Motivation

I often use open source repos to compare my solutions with those of someone who has tackled the same problem before, and I like learning how my dependencies work under the hood. Both of these tasks were tedious manually, but were always worth it to get to quality solutions. Nowadays, thanks to Claude Code and Codex, that task is much easier. However, tooling is limited. The problem with GitHub is that the standard `fetch` tools struggle to see the file tree, and AI agents have to work around JavaScript-heavy file pages by using raw.githubusercontent.com. `gh-viewer` solves these problems. Just tell your AI agent to learn how to use `gh-viewer` by invoking `gh-viewer -h`, and then you can ask it specific questions about your target repo, like "using gh-viewer, please study how useState is implemented in facebook/react, and how I might implement my own from scratch".

## Installation

```
npm install --global @kennyfrc/gh-viewer
```

Or run directly without installing:

```
npx @kennyfrc/gh-viewer --help
```

To hack on the CLI locally without publishing:

```
npm install
npm run build
node dist/cli.js --help
```

## Authentication

Unauthenticated requests are limited to 60 per hour per IP ([GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28)). Export a personal access token to increase the limit to 5,000 requests per hour.

```
export GITHUB_TOKEN=ghp_...
```

See [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api?apiVersion=2022-11-28) for token guidance.

## Usage

```
gh-viewer --repo owner/name [--ref main] --list path
gh-viewer --repo owner/name --read path[@start-end]
gh-viewer --repo owner/name --read path --line-numbers
gh-viewer --repo owner/name [--ref main] --glob "src/**/*.ts"
gh-viewer --search-repos --pattern viewer --language TypeScript --limit 20
gh-viewer --repo owner/name --search-code --pattern "createViewer" --path src
gh-viewer --repo owner/name --commit-search --query "fix" --since 2024-01-01
gh-viewer --repo owner/name --diff --base main --head feature --include-patches
gh-viewer --org my-org --list-repos
gh-viewer --user octocat --list-repos
```

### Release

```
npm run release
```

This runs `npm pkg fix`, bumps the patch version, rebuilds, and publishes.

### Options

- `--repo <owner/repo>` — target repository for list/read/glob.
- `--org <name>` / `--user <name>` — list repositories for an organization or user.
- `--list <path>` — list entries at `path` (default `.`) in the repository.
- `--read <path[@start-end]>` — print file contents; optional `@start-end` limits the line range.
- `--glob <pattern>` — filter the repository tree with a glob expression (uses [`minimatch`](https://github.com/isaacs/minimatch)).
- `--search-repos` — search repositories with optional `--pattern`, `--language`, `--limit`, and `--offset` filters.
- `--search-code` — run a code search within the repository (requires `--pattern`; supports `--path`, `--limit`, `--offset`).
- `--commit-search` — search commits with optional `--query`, `--author`, `--path`, `--since`, `--until`, `--limit`, `--offset`.
- `--diff` — compare refs using `--base` and `--head`, optionally `--include-patches` to embed unified diffs.
- `--ref <branch|tag|sha>` — override the default branch when resolving content.
- `--json` — output machine-readable JSON instead of the default transcript.
- `--help` — print usage help.
- `--line-numbers` — prefix read output with line numbers for reproducible transcripts.

## Programmatic API

```ts
import { createViewer, parseRepo } from "@kennyfrc/gh-viewer";

const viewer = createViewer({ token: process.env.GITHUB_TOKEN });
const repo = parseRepo("octocat/hello-world");
const listing = await viewer.listPath(repo, ".", { ref: "main" });

console.log(listing.entries);
```

Additional helpers let you stay inside GitHub's REST API without cloning:

- `viewer.searchRepositories({ pattern, organization, language, limit, offset })` prioritises repos you can access before falling back to public search.
- `viewer.searchCode(repo, { pattern, path, limit, offset })` returns snippets grouped by file with surrounding context.
- `viewer.searchCommits(repo, { query, author, path, since, until, limit, offset })` surfaces commit metadata.
- `viewer.compareCommits(repo, base, head, { includePatches })` returns ahead/behind stats and per-file changes.

## Examples

```
gh-viewer --org e2b-dev --list-repos
gh-viewer --repo e2b-dev/E2B --list packages/js-sdk/src
gh-viewer --repo e2b-dev/E2B --read packages/js-sdk/src/api/index.ts@1-150
gh-viewer --repo e2b-dev/E2B --glob "spec/**/*.proto"
```

Each successful action echoes a `✓` line, mirroring the sample transcript.

## License

Released under the [MIT License](LICENSE).

## Notes

- `--glob` pulls the full recursive tree (`GET /git/trees/:sha?recursive=1`). The response is truncated when the tree exceeds 100,000 entries or about 7 MB ([Git trees API](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#get-a-tree)).
- Large files (>1 MB) require the raw media type; extremely large files (>100 MB) are unavailable via the contents API ([Get repository content](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content)).
- Provide explicit line ranges when reading large files to keep output manageable.
