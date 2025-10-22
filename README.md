# gh-viewer

`gh-viewer` lets you explore GitHub repositories from the command line using the GitHub REST API. It focuses on three operations:

- list directories within a repo (`--list`)
- read file contents with optional line ranges (`--read`)
- run glob patterns against the repository tree (`--glob`)

AI agents love it because it trades GitHub's sluggish web UI for scriptable queries. Pair `gh-viewer` with an AI code assistant to skim public repositories quickly, follow glob leads, and read files in context without bouncing through browser tabs.

## Installation

```
npm install --global gh-viewer
```

Or run directly without installing:

```
npx gh-viewer --help
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
gh-viewer --repo owner/name [--ref main] --glob "src/**/*.ts"
gh-viewer --org my-org --list-repos
gh-viewer --user octocat --list-repos
```

### Options

- `--repo <owner/repo>` — target repository for list/read/glob.
- `--org <name>` / `--user <name>` — list repositories for an organization or user.
- `--list <path>` — list entries at `path` (default `.`) in the repository.
- `--read <path[@start-end]>` — print file contents; optional `@start-end` limits the line range.
- `--glob <pattern>` — filter the repository tree with a glob expression (uses [`minimatch`](https://github.com/isaacs/minimatch)).
- `--ref <branch|tag|sha>` — override the default branch when resolving content.
- `--json` — output machine-readable JSON instead of the default transcript.
- `--help` — print usage help.

## Programmatic API

```ts
import { createViewer, parseRepo } from "gh-viewer";

const viewer = createViewer({ token: process.env.GITHUB_TOKEN });
const repo = parseRepo("octocat/hello-world");
const listing = await viewer.listPath(repo, ".", { ref: "main" });

console.log(listing.entries);
```

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
