#!/usr/bin/env node

import {
  createViewer,
  parseRepo,
  scopeLabel,
  ViewerError,
  type DirectoryEntry,
  type RepoTarget,
  type Scope,
  type ReadRange,
  type RepositorySummary,
  type CodeSearchResultItem,
  type CodeSearchSnippet,
  type CommitSearchResultItem,
  type CompareCommitsResult,
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
  searchRepos?: boolean;
  list?: string;
  read?: string;
  glob?: string;
  searchCode?: boolean;
  commitSearch?: boolean;
  diff?: boolean;
  ref?: string;
  branch?: string;
  pattern?: string;
  language?: string;
  limit?: number;
  offset?: number;
  pathFilter?: string;
  author?: string;
  query?: string;
  since?: string;
  until?: string;
  base?: string;
  head?: string;
  includePatches?: boolean;
  lineNumbers?: boolean;
  lineRange?: [number, number];
  context?: number;
  contextAfter?: number;
  contextBefore?: number;
}

type CliOutput =
  | { action: "list-repos"; scope: Scope; repos: string[] }
  | {
      action: "search-repos";
      params: {
        pattern?: string;
        organization?: string;
        language?: string;
        limit: number;
        offset: number;
      };
      repositories: RepositorySummary[];
    }
  | {
      action: "list";
      repo: RepoTarget;
      ref?: string;
      path: string;
      entries: DirectoryEntry[];
    }
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
    }
  | {
      action: "code-search";
      repo: RepoTarget;
      pattern: string;
      path?: string;
      limit: number;
      offset: number;
      results: CodeSearchResultItem[];
    }
  | {
      action: "commit-search";
      repo: RepoTarget;
      options: {
        query?: string;
        author?: string;
        path?: string;
        since?: string;
        until?: string;
        limit: number;
        offset: number;
      };
      results: CommitSearchResultItem[];
    }
  | {
      action: "compare";
      repo: RepoTarget;
      base: string;
      head: string;
      includePatches: boolean;
      result: CompareCommitsResult;
    };

const viewer = createViewer();
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const outputs: CliOutput[] = [];
let performedAction = false;

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
    performedAction = true;
  }

  if (args.searchRepos) {
    const limit = args.limit ?? 30;
    const offset = args.offset ?? 0;
    const params = {
      pattern: args.pattern,
      organization: args.org,
      language: args.language,
      limit,
      offset,
    };
    const repositories = await viewer.searchRepositories(params);
    if (args.json) {
      outputs.push({ action: "search-repos", params, repositories });
    } else {
      const detailParts = [] as string[];
      if (params.pattern) {
        detailParts.push(`pattern="${params.pattern}"`);
      }
      if (params.organization) {
        detailParts.push(`org=${params.organization}`);
      }
      if (params.language) {
        detailParts.push(`language=${params.language}`);
      }
      detailParts.push(`limit=${limit}`);
      if (offset > 0) {
        detailParts.push(`offset=${offset}`);
      }
      logSuccess("Search Repositories", detailParts.join(" "));
      for (const repo of repositories) {
        const visibility = repo.visibility ?? (repo.private ? "private" : "public");
        console.log(`${repo.fullName} (${visibility})`);
        console.log(`  ⭐ ${repo.stars}  Forks ${repo.forks}`);
        if (repo.description) {
          console.log(`  ${repo.description}`);
        }
      }
    }
    performedAction = true;
  }

  const repoTarget = args.repo ? parseRepo(args.repo) : null;
  if ((args.list || args.read || args.glob || args.searchCode || args.commitSearch || args.diff) && !repoTarget) {
    throw new CliError("Missing --repo owner/name for repository operations.");
  }

  if (args.list && repoTarget) {
    const ref = args.ref ?? args.branch ?? undefined;
    const listOptions = {
      ref,
      limit: args.limit,
      offset: args.offset,
    };
    const listResult = await viewer.listPath(repoTarget, args.list, listOptions);
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
        console.log(formatDirectoryEntry(entry));
      }
    }
    performedAction = true;
  }

  if (args.read && repoTarget) {
    const ref = args.ref ?? args.branch ?? undefined;
    let readPath = args.read;
    let readRange: ReadRange | undefined;
    
    if (args.lineRange && args.read?.includes('@')) {
      console.warn("Warning: --line-range overrides @start-end suffix in path");
    }
    
    if (args.lineRange) {
      const [start, end] = args.lineRange;
      readRange = { start, end };
      readPath = readPath.split('@')[0];
    } else {
      const { path, range } = parseReadArg(args.read);
      readPath = path;
      readRange = range;
    }
    
    const readResult = await viewer.readFile(repoTarget, readPath, {
      ref,
      range: readRange,
      includeLineNumbers: Boolean(args.lineNumbers),
    });
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
    performedAction = true;
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
    performedAction = true;
  }

  if (args.searchCode && repoTarget) {
    const limit = args.limit ?? 30;
    const offset = args.offset ?? 0;
    if (!args.pattern) {
      throw new CliError("--pattern is required for --search-code");
    }
    
    // -C conflicts with -A/-B to prevent ambiguity
    if (args.context !== undefined && (args.contextAfter !== undefined || args.contextBefore !== undefined)) {
      throw new CliError("--context/-C cannot be used with -A or -B flags");
    }
    
    let contextLines: number | undefined;
    if (args.context !== undefined) {
      contextLines = args.context;
    } else if (args.contextAfter !== undefined && args.contextBefore !== undefined) {
      contextLines = Math.max(args.contextAfter, args.contextBefore);
    } else if (args.contextAfter !== undefined) {
      contextLines = args.contextAfter;
    } else if (args.contextBefore !== undefined) {
      contextLines = args.contextBefore;
    }
    const results = await viewer.searchCode(repoTarget, {
      pattern: args.pattern,
      path: args.pathFilter,
      limit,
      offset,
      context: contextLines,
    });
    if (args.json) {
      outputs.push({
        action: "code-search",
        repo: repoTarget,
        pattern: args.pattern,
        path: args.pathFilter,
        limit,
        offset,
        results,
      });
    } else {
      const detailParts = [`pattern="${args.pattern}"`, `limit=${limit}`];
      if (args.pathFilter) {
        detailParts.push(`path=${args.pathFilter}`);
      }
      if (offset > 0) {
        detailParts.push(`offset=${offset}`);
      }
      logSuccess("Code Search", detailParts.join(" "));
      for (const item of results) {
        console.log(`${item.repository.fullName}/${item.path} @ ${item.ref}`);
        for (const snippet of item.snippets) {
          printSnippet(snippet);
        }
      }
    }
    performedAction = true;
  }

  if (args.commitSearch && repoTarget) {
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const options = {
      query: args.query,
      author: args.author,
      path: args.pathFilter,
      since: args.since,
      until: args.until,
      limit,
      offset,
    };
    const results = await viewer.searchCommits(repoTarget, options);
    if (args.json) {
      outputs.push({ action: "commit-search", repo: repoTarget, options, results });
    } else {
      const detailParts = [] as string[];
      if (args.query) {
        detailParts.push(`query="${args.query}"`);
      }
      if (args.author) {
        detailParts.push(`author=${args.author}`);
      }
      if (args.pathFilter) {
        detailParts.push(`path=${args.pathFilter}`);
      }
      if (args.since) {
        detailParts.push(`since=${args.since}`);
      }
      if (args.until) {
        detailParts.push(`until=${args.until}`);
      }
      detailParts.push(`limit=${limit}`);
      if (offset > 0) {
        detailParts.push(`offset=${offset}`);
      }
      logSuccess("Commit Search", detailParts.join(" "));
      for (const commit of results) {
        console.log(`${commit.sha.slice(0, 12)} ${commit.message.split("\n")[0] ?? ""}`);
        if (commit.authorName) {
          console.log(`  Author: ${commit.authorName}${commit.authorEmail ? ` <${commit.authorEmail}>` : ""}`);
        }
        if (commit.date) {
          console.log(`  Date: ${commit.date}`);
        }
        if (commit.stats) {
          console.log(
            `  Stats: +${commit.stats.additions ?? 0} -${commit.stats.deletions ?? 0} (${commit.stats.total ?? 0} files)`
          );
        }
      }
    }
    performedAction = true;
  }

  if (args.diff && repoTarget) {
    const baseRef = args.base;
    const headRef = args.head;
    if (!baseRef) {
      throw new CliError("--base is required for --diff");
    }
    if (!headRef) {
      throw new CliError("--head is required for --diff");
    }
    const includePatches = Boolean(args.includePatches);
    const result = await viewer.compareCommits(repoTarget, baseRef, headRef, {
      includePatches,
    });
    if (args.json) {
      outputs.push({
        action: "compare",
        repo: repoTarget,
        base: baseRef,
        head: headRef,
        includePatches,
        result,
      });
    } else {
      logSuccess(
        "Compare",
        `${repoTarget.owner}/${repoTarget.repo} ${baseRef}...${headRef} (ahead ${result.aheadBy}, behind ${result.behindBy})`
      );
      for (const file of result.files) {
        console.log(`${file.status.padEnd(8)} ${file.filename} (+${file.additions} -${file.deletions})`);
        if (includePatches && file.patch) {
          console.log(file.patch);
        }
      }
    }
    performedAction = true;
  }

  if (args.json) {
    console.log(JSON.stringify(outputs, null, 2));
  }

  if (!performedAction && !args.json) {
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
    } else if (arg === "--json" || arg === "-j") {
      parsed.json = true;
    } else if (arg === "--repo") {
      parsed.repo = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--org") {
      parsed.org = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--user") {
      parsed.user = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--list-repos") {
      parsed.listRepos = true;
    } else if (arg === "--search-repos") {
      parsed.searchRepos = true;
    } else if (arg === "--list" || arg === "-l") {
      if (parsed.list !== undefined) {
        throw new CliError(`Duplicate list option: ${arg}`);
      }
      parsed.list = valueOrThrow(arg, argv[++index] ?? ".");
    } else if (arg === "--read" || arg === "-r") {
      if (parsed.read !== undefined) {
        throw new CliError(`Duplicate read option: ${arg}`);
      }
      parsed.read = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--glob" || arg === "-g") {
      if (parsed.glob !== undefined) {
        throw new CliError(`Duplicate glob option: ${arg}`);
      }
      parsed.glob = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--search-code") {
      parsed.searchCode = true;
    } else if (arg === "--commit-search") {
      parsed.commitSearch = true;
    } else if (arg === "--diff") {
      parsed.diff = true;
    } else if (arg === "--ref") {
      parsed.ref = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--branch") {
      parsed.branch = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--pattern") {
      parsed.pattern = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--language") {
      parsed.language = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--limit") {
      parsed.limit = numberOrThrow(arg, argv[++index]);
    } else if (arg === "--offset") {
      parsed.offset = numberOrThrow(arg, argv[++index]);
    } else if (arg === "--path") {
      parsed.pathFilter = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--author") {
      parsed.author = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--query") {
      parsed.query = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--since") {
      parsed.since = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--until") {
      parsed.until = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--base") {
      parsed.base = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--head") {
      parsed.head = valueOrThrow(arg, argv[++index]);
    } else if (arg === "--include-patches") {
      parsed.includePatches = true;
    } else if (arg === "--line-numbers") {
      parsed.lineNumbers = true;
    } else if (arg === "--line-range") {
      const start = numberOrThrow(arg, argv[++index]);
      const end = numberOrThrow(arg, argv[++index]);
      if (end < start) {
        throw new CliError(`Invalid --line-range: end (${end}) must be >= start (${start})`);
      }
      parsed.lineRange = [start, end];
    } else if (arg === "-A") {
      parsed.contextAfter = numberOrThrow(arg, argv[++index]);
    } else if (arg === "-B") {
      parsed.contextBefore = numberOrThrow(arg, argv[++index]);
    } else if (arg === "-C") {
      parsed.context = numberOrThrow(arg, argv[++index]);
    } else if (arg === "--context") {
      parsed.context = numberOrThrow(arg, argv[++index]);
    } else {
      throw new CliError(`Unknown option: ${arg}. Use --help for available options.`);
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

function numberOrThrow(option: string, value?: string): number {
  const raw = valueOrThrow(option, value);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`Invalid number for ${option}: ${raw}`);
  }
  if (parsed < 0) {
    throw new CliError(`Value for ${option} must be non-negative.`);
  }
  return parsed;
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

function formatDirectoryEntry(entry: DirectoryEntry): string {
  if (entry.type === "file") {
    const size = typeof entry.size === "number" ? ` ${entry.size}B` : "";
    return `- ${entry.name}${size}`;
  }
  if (entry.type === "dir") {
    return `d ${entry.name}/`;
  }
  if (entry.type === "symlink") {
    const target = entry.target ? ` -> ${entry.target}` : "";
    return `l ${entry.name}${target}`;
  }
  if (entry.type === "submodule") {
    return `m ${entry.name}`;
  }
  return `${entry.type} ${entry.name}`;
}

function printSnippet(snippet: CodeSearchSnippet): void {
  for (let lineIndex = 0; lineIndex < snippet.lines.length; lineIndex += 1) {
    const lineNumber = snippet.startLine + lineIndex;
    console.log(`${lineNumber.toString().padStart(6, " ")} ${snippet.lines[lineIndex] ?? ""}`);
  }
  if (snippet.lines.length > 0) {
    console.log("");
  }
}

function logSuccess(action: string, detail?: string): void {
  console.log(`✓ ${action}`);
  if (detail) {
    console.log(detail);
  }
}

function printHelp(): void {
  const lines = [
    "USAGE:",
    "  gh-viewer --repo owner/name [--ref main] --list path",
    "  gh-viewer --repo owner/name --read path[@start-end]",
    "  gh-viewer --repo owner/name --read path --line-range 50 100",
    '  gh-viewer --repo owner/name [--ref main] --glob "pattern"',
    "",
    "OPTIONS:",
    "  -h, --help               Show this help message",
    "  -j, --json               Output JSON instead of human-readable text",
    "  -l, --list [path]        List directory entries (default: .)",
    "  -r, --read <path>        Read file contents",
    "  -g, --glob <pattern>     Find files matching pattern",
    "  --ref <ref>              Override branch/tag/SHA",
    "  --branch <name>          Alias for --ref",
    "  --pattern <text>         Pattern for repository or code searches",
    "  --language <lang>        Filter repositories by language",
    "  --limit <n>              Limit results",
    "  --offset <n>             Skip results before returning",
    "  --path <glob>            Restrict code/commit search to path",
    "  --query <text>           Additional query for commit search",
    "  --author <user>          Filter commits by author",
    "  --since <iso>            Filter commits >= ISO 8601 date",
    "  --until <iso>            Filter commits <= ISO 8601 date",
    "  --base <ref>             Base reference for diffs",
    "  --head <ref>             Head reference for diffs",
    "  --include-patches        Include patch text in diff results",
    "  --line-numbers           Prefix read output with line numbers",
    "  --list-repos             List repositories for org/user",
    "  --org <name>             List repositories for organization",
    "  --user <name>            List repositories for user",
    "  --search-repos           Search accessible and public repositories",
    "  --search-code            Run code search (requires --pattern)",
    "  -A <n>                   Show n lines after search match",
    "  -B <n>                   Show n lines before search match", 
    "  -C <n>                   Show n lines before/after search match",
    "  --context <n>            Same as -C for search-code",
    "  --commit-search          Search commits within repository",
    "  --diff                   Compare two refs within repository",
    "",
    "EXAMPLES:",
    "  gh-viewer --repo facebook/react -l packages",
    "  gh-viewer --repo owner/name -r README.md -j",
    "  gh-viewer --repo owner/name -g \"**/*.ts\" --limit 10",
    "  gh-viewer --org my-org --search-repos --pattern \"cli\" -j",
  ];
  console.log(lines.join("\n"));
}
