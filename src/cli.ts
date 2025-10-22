#!/usr/bin/env node

import {
  createViewer,
  parseRepo,
  scopeLabel,
  ViewerError,
  type RepoTarget,
  type Scope,
  type ReadRange,
} from "./viewer.js";

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

interface CliArgs {
  help?: boolean;
  json?: boolean;
  repo?: string;
  org?: string;
  user?: string;
  listRepos: boolean;
  list?: string;
  read?: string;
  glob?: string;
  ref?: string;
  branch?: string;
}

type CliOutput =
  | { action: "list-repos"; scope: Scope; repos: string[] }
  | { action: "list"; repo: RepoTarget; ref?: string; path: string; entries: string[] }
  | {
      action: "read";
      repo: RepoTarget;
      ref?: string;
      path: string;
      range?: ReadRange;
      lines: string[];
    }
  | {
      action: "glob";
      repo: RepoTarget;
      ref: string;
      pattern: string;
      matches: string[];
      truncated: boolean;
    };

type ActionSummary =
  | { action: "list-repos"; scope: Scope; count: number }
  | { action: "list"; repo: RepoTarget; ref?: string; path: string; count: number }
  | { action: "read"; repo: RepoTarget; ref?: string; path: string; range?: ReadRange; lines: number }
  | { action: "glob"; repo: RepoTarget; ref: string; pattern: string; matches: number; truncated: boolean };

const viewer = createViewer();
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const outputs: CliOutput[] = [];
const actions: ActionSummary[] = [];

try {
  if (args.listRepos) {
    const scope = args.org
      ? ({ type: "org", value: args.org } as Scope)
      : args.user
      ? ({ type: "user", value: args.user } as Scope)
      : null;
    if (!scope) {
      throw new CliError("Missing --org or --user for --list-repos. See --help for usage.");
    }
    const repos = await viewer.listRepositories(scope);
    if (args.json) {
      outputs.push({ action: "list-repos", scope, repos });
    } else {
      logSuccess("List Repositories", scopeLabel(scope));
      for (const repo of repos) {
        console.log(repo);
      }
    }
    actions.push({ action: "list-repos", scope, count: repos.length });
  }

  const repoTarget = args.repo ? parseRepo(args.repo) : null;
  if ((args.list || args.read || args.glob) && !repoTarget) {
    throw new CliError("Missing --repo owner/name for repository operations.");
  }

  if (args.list && repoTarget) {
    const ref = args.ref ?? args.branch ?? undefined;
    const listResult = await viewer.listPath(repoTarget, args.list, { ref });
    if (args.json) {
      outputs.push({
        action: "list",
        repo: repoTarget,
        ref: listResult.ref,
        path: listResult.path,
        entries: listResult.entries,
      });
    } else {
      logSuccess(
        "List",
        `${listResult.path} in https://github.com/${repoTarget.owner}/${repoTarget.repo}${
          listResult.ref ? `@${listResult.ref}` : ""
        }`
      );
      for (const entry of listResult.entries) {
        console.log(entry);
      }
    }
    actions.push({
      action: "list",
      repo: repoTarget,
      ref: listResult.ref,
      path: listResult.path,
      count: listResult.entries.length,
    });
  }

  if (args.read && repoTarget) {
    const ref = args.ref ?? args.branch ?? undefined;
    const { path, range } = parseReadArg(args.read);
    const readResult = await viewer.readFile(repoTarget, path, { ref, range });
    if (args.json) {
      outputs.push({
        action: "read",
        repo: repoTarget,
        ref: readResult.ref,
        path: readResult.path,
        range: readResult.range,
        lines: readResult.lines,
      });
    } else {
      const rangeLabel = readResult.range
        ? ` @${readResult.range.start}-${readResult.range.end}`
        : "";
      logSuccess(
        "Read",
        `${repoTarget.owner}/${repoTarget.repo}/${readResult.path}${rangeLabel}`
      );
      for (const line of readResult.lines) {
        console.log(line);
      }
    }
    actions.push({
      action: "read",
      repo: repoTarget,
      ref: readResult.ref,
      path: readResult.path,
      range: readResult.range,
      lines: readResult.lines.length,
    });
  }

  if (args.glob && repoTarget) {
    const ref = args.ref ?? args.branch ?? undefined;
    const globResult = await viewer.globFiles(repoTarget, args.glob, { ref });
    if (args.json) {
      outputs.push({
        action: "glob",
        repo: repoTarget,
        ref: globResult.ref,
        pattern: globResult.pattern,
        matches: globResult.matches,
        truncated: globResult.truncated,
      });
    } else {
      logSuccess(
        "Glob",
        `${globResult.pattern} in ${repoTarget.owner}/${repoTarget.repo}${
          globResult.ref ? `@${globResult.ref}` : ""
        }`
      );
      for (const match of globResult.matches) {
        console.log(match);
      }
      if (globResult.truncated) {
        console.error("Tree response truncated by GitHub; matches may be incomplete.");
      }
    }
    actions.push({
      action: "glob",
      repo: repoTarget,
      ref: globResult.ref,
      pattern: globResult.pattern,
      matches: globResult.matches.length,
      truncated: globResult.truncated,
    });
  }

  if (args.json) {
    console.log(JSON.stringify(outputs, null, 2));
  }

  if (actions.length === 0 && !args.json) {
    printHelp();
  }
} catch (error) {
  if (error instanceof CliError || error instanceof ViewerError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    listRepos: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--repo") {
      parsed.repo = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--org") {
      parsed.org = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--user") {
      parsed.user = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--list-repos") {
      parsed.listRepos = true;
    } else if (arg === "--list") {
      parsed.list = valueOrThrow(arg, argv[++index] ?? ".");
    } else if (arg === "--read") {
      parsed.read = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--glob") {
      parsed.glob = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--ref") {
      parsed.ref = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--branch") {
      parsed.branch = valueOrThrow(arg, argv[++index]);
    } else {
      throw new CliError(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function valueOrThrow(option: string, value?: string): string {
  if (!value) {
    throw new CliError(`Missing value for ${option}`);
  }
  return value;
}

function parseReadArg(arg: string): { path: string; range?: ReadRange } {
  const [path, suffix] = arg.split("@");
  if (!path) {
    throw new CliError("Read target must include a path.");
  }
  if (!suffix) {
    return { path };
  }
  const rangeMatch = suffix.match(/^(\d+)-(\d+)$/);
  if (!rangeMatch) {
    throw new CliError(`Invalid range "${suffix}". Use start-end.`);
  }
  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
    throw new CliError(`Invalid range "${suffix}". Ensure 1 <= start <= end.`);
  }
  return { path, range: { start, end } };
}

function logSuccess(action: string, detail?: string): void {
  console.log(`✓ ${action}`);
  if (detail) {
    console.log(detail);
  }
}

function printHelp(): void {
  const lines = [
    "gh-viewer --repo owner/name [--ref main] --list path",
    "gh-viewer --repo owner/name --read path[@start-end]",
    'gh-viewer --repo owner/name [--ref main] --glob "pattern"',
    "gh-viewer --org org --list-repos",
    "gh-viewer --user user --list-repos",
    "",
    "Options:",
    "  --repo owner/name        Target repository.",
    "  --org name               List repositories for an organization.",
    "  --user name              List repositories for a user.",
    "  --list path              List the entries at path (default .).",
    "  --read path[@start-end]  Read file contents with optional line range.",
    '  --glob "pattern"         Glob files via git trees API.',
    "  --ref ref                Override branch/tag/SHA.",
    "  --branch name            Alias for --ref.",
    "  --list-repos             List repositories for the given org/user.",
    "  --json                   Emit JSON instead of human output.",
    "  --help                   Show this message.",
  ];
  console.log(lines.join("\n"));
}
