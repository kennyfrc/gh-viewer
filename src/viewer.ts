import { minimatch } from "minimatch";
import { Buffer } from "node:buffer";
import packageJson from "../package.json" with { type: "json" };

const DEFAULT_USER_AGENT = typeof packageJson?.version === "string"
  ? `gh-viewer/${packageJson.version}`
  : "gh-viewer";

export type Scope = { type: "org" | "user"; value: string };

export interface RepoTarget {
  owner: string;
  repo: string;
}

export interface ListOptions {
  ref?: string;
  limit?: number;
  offset?: number;
}

export type DirectoryEntryType = "file" | "dir" | "symlink" | "submodule" | "other";

export interface DirectoryEntry {
  name: string;
  type: DirectoryEntryType;
  size?: number;
  target?: string;
  sha?: string;
}

export interface ListResult {
  path: string;
  ref?: string;
  entries: DirectoryEntry[];
}

export interface ReadRange {
  start: number;
  end: number;
}

export interface ReadOptions {
  ref?: string;
  range?: ReadRange;
  includeLineNumbers?: boolean;
}

export interface ReadResult {
  path: string;
  ref?: string;
  range?: ReadRange;
  lines: string[];
}

export interface GlobOptions {
  ref?: string;
}

export interface GlobResult {
  pattern: string;
  ref: string;
  matches: string[];
  truncated: boolean;
}

export interface RepositorySearchParams {
  pattern?: string;
  organization?: string;
  language?: string;
  limit?: number;
  offset?: number;
}

export interface RepositorySummary {
  name: string;
  fullName: string;
  description?: string | null;
  language?: string | null;
  stars: number;
  forks: number;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
  topics: string[];
  visibility?: string;
}

export interface CodeSearchOptions {
  pattern: string;
  path?: string;
  limit?: number;
  offset?: number;
  context?: number;
}

export interface CodeSearchSnippet {
  startLine: number;
  endLine: number;
  lines: string[];
}

export interface CodeSearchResultItem {
  repository: RepoTarget & { fullName: string };
  path: string;
  ref: string;
  language?: string | null;
  score?: number;
  snippets: CodeSearchSnippet[];
  htmlUrl: string;
}

export interface CommitSearchOptions {
  query?: string;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface CommitSearchResultItem {
  sha: string;
  message: string;
  authorName?: string | null;
  authorEmail?: string | null;
  date?: string;
  htmlUrl: string;
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
}

export interface CompareOptions {
  includePatches?: boolean;
}

export interface CompareFileChange {
  sha?: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

export interface CompareCommitsResult {
  base: string;
  head: string;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: CompareFileChange[];
}

export interface ViewerOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export interface Viewer {
  listRepositories(scope: Scope): Promise<string[]>;
  searchRepositories(params?: RepositorySearchParams): Promise<RepositorySummary[]>;
  listPath(repo: RepoTarget, path: string, options?: ListOptions): Promise<ListResult>;
  readFile(repo: RepoTarget, path: string, options?: ReadOptions): Promise<ReadResult>;
  globFiles(repo: RepoTarget, pattern: string, options?: GlobOptions): Promise<GlobResult>;
  searchCode(
    repo: RepoTarget,
    options: CodeSearchOptions
  ): Promise<CodeSearchResultItem[]>;
  searchCommits(
    repo: RepoTarget,
    options?: CommitSearchOptions
  ): Promise<CommitSearchResultItem[]>;
  compareCommits(
    repo: RepoTarget,
    base: string,
    head: string,
    options?: CompareOptions
  ): Promise<CompareCommitsResult>;
}

export class ViewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewerError";
  }
}

interface TreeCacheEntry {
  matches: string[];
  truncated: boolean;
}

interface GitHubRepoSummary {
  id?: number;
  full_name?: string;
  name?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  private?: boolean;
  html_url?: string;
  default_branch?: string;
  topics?: string[];
  visibility?: string;
  owner?: { login?: string };
  score?: number;
}

interface GitHubContentEntry {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  target?: string;
  content?: string;
  encoding?: string;
  sha?: string;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

interface GitHubCodeSearchItem {
  path: string;
  sha: string;
  html_url: string;
  score?: number;
  repository: {
    full_name: string;
    name: string;
    owner?: { login?: string };
  };
  text_matches?: GitHubTextMatch[];
}

interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
}

interface GitHubTextMatch {
  fragment?: string;
  matches?: { text?: string }[];
}

interface GitHubBlobResponse {
  content?: string;
  encoding?: string;
}

interface GitHubCommitSearchItem {
  sha: string;
  html_url: string;
  commit: {
    message?: string;
    author?: {
      name?: string;
      email?: string;
      date?: string;
    };
  };
  author?: {
    login?: string;
  };
  stats?: {
    additions?: number;
    deletions?: number;
    total?: number;
  };
}

interface GitHubCommitSearchResponse {
  items?: GitHubCommitSearchItem[];
}

interface GitHubCompareFile {
  sha?: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

interface GitHubCompareResponse {
  base_commit?: { sha?: string };
  merge_base_commit?: { sha?: string };
  commits?: { sha: string }[];
  ahead_by?: number;
  behind_by?: number;
  total_commits?: number;
  files?: GitHubCompareFile[];
}

/** Creates viewer with GitHub auth and fetch binding */
export function createViewer(options: ViewerOptions = {}): Viewer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authToken = options.token ?? process.env.GITHUB_TOKEN ?? null;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const treeCache = new Map<string, TreeCacheEntry>();
  const blobCache = new Map<string, string[]>();
  const repoDefaults = new Map<string, string>();

  async function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (init.headers) {
      const extraHeaders = new Headers(init.headers);
      extraHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }
    const response = await fetchImpl(url, { ...init, headers });
    if (!response.ok) {
      const details = await safeReadError(response);
      const limitHint =
        response.status === 403 || response.status === 429
          ? " (check rate limits or required scopes)"
          : "";
      throw new ViewerError(
        `GitHub request failed (${response.status} ${response.statusText})${limitHint}: ${details}`
      );
    }
    return response;
  }

  async function listRepositories(scope: Scope): Promise<string[]> {
    const results: string[] = [];
    let url: string | null =
      scope.type === "org"
        ? `https://api.github.com/orgs/${encodeURIComponent(scope.value)}/repos?per_page=100`
        : `https://api.github.com/users/${encodeURIComponent(scope.value)}/repos?per_page=100`;
    while (url) {
      const currentUrl = url;
      const response = await ghFetch(currentUrl);
      const page = (await response.json()) as GitHubRepoSummary[];
      for (const repo of page) {
        results.push(repo.full_name ?? repo.name ?? "");
      }
      url = parseNextLink(response.headers.get("link"));
    }
    return results.filter((entry) => entry.length > 0);
  }

  /** Prioritizes accessible repos before falling back to public search */
  async function searchRepositories(
    params: RepositorySearchParams = {}
  ): Promise<RepositorySummary[]> {
    const limit = normalizeLimit(params.limit, 30, 100);
    const offset = normalizeOffset(params.offset);
    const toCollect = offset + limit;
    const pattern = params.pattern?.trim();
    const organization = params.organization?.trim();
    const language = params.language?.trim();

    const collected = new Map<
      string,
      { summary: RepositorySummary; priority: number; stars: number; score?: number }
    >();

    const maxIntermediate = toCollect + 100;

    async function collectOrgRepositories(org: string): Promise<void> {
      let url: string | null = `https://api.github.com/orgs/${encodeURIComponent(
        org
      )}/repos?per_page=100&type=all&sort=updated&direction=desc`;
      while (url) {
        const response = await ghFetch(url);
        const page = (await response.json()) as GitHubRepoSummary[];
        for (const repo of page) {
          addRepository(repo, 0);
          if (collected.size >= maxIntermediate) {
            return;
          }
        }
        url = parseNextLink(response.headers.get("link"));
      }
    }

    async function collectUserRepositories(): Promise<void> {
      if (!authToken) {
        return;
      }
      let url: string | null =
        "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=updated&direction=desc";
      while (url) {
        const response = await ghFetch(url);
        const page = (await response.json()) as GitHubRepoSummary[];
        for (const repo of page) {
          addRepository(repo, 0);
          if (collected.size >= maxIntermediate) {
            return;
          }
        }
        url = parseNextLink(response.headers.get("link"));
      }
    }

    function addRepository(repo: GitHubRepoSummary, priority: number): void {
      const summary = mapRepoSummary(repo);
      if (!summary) {
        return;
      }
      if (organization && repo.owner?.login && !equalsIgnoreCase(repo.owner.login, organization)) {
        return;
      }
      if (pattern && !matchesPattern(summary.fullName, pattern) && !matchesPattern(summary.name, pattern)) {
        return;
      }
      if (language && summary.language && !equalsIgnoreCase(summary.language, language)) {
        return;
      }
      if (language && !summary.language && priority > 0) {
        return;
      }
      const existing = collected.get(summary.fullName);
      if (!existing || existing.priority > priority) {
        collected.set(summary.fullName, {
          summary,
          priority,
          stars: summary.stars,
          score: repo.score,
        });
      }
    }

    async function collectSearchResults(): Promise<void> {
      const qualifiers: string[] = [];
      if (pattern && pattern.length > 0) {
        qualifiers.push(pattern);
      }
      if (organization) {
        qualifiers.push(`org:${organization}`);
      }
      if (language) {
        qualifiers.push(`language:${language}`);
      }
      if (qualifiers.length === 0) {
        qualifiers.push("stars:>0");
      }
      if (!qualifiers.some((entry) => entry.startsWith("in:"))) {
        qualifiers.push("in:name");
      }
      const query = qualifiers.join(" ");
      let page = 1;
      while (collected.size < maxIntermediate) {
        const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(
          query
        )}&per_page=100&page=${page}&sort=stars&order=desc`;
        const response = await ghFetch(searchUrl);
        const body = (await response.json()) as { items?: GitHubRepoSummary[] };
        const items = body.items ?? [];
        if (items.length === 0) {
          break;
        }
        for (const repo of items) {
          addRepository(repo, 1);
          if (collected.size >= maxIntermediate) {
            break;
          }
        }
        if (items.length < 100) {
          break;
        }
        page += 1;
      }
    }

    if (organization) {
      await collectOrgRepositories(organization);
    } else {
      try {
        await collectUserRepositories();
      } catch (error) {
        if (!(error instanceof ViewerError)) {
          throw error;
        }
      }
    }

    if (collected.size < toCollect) {
      await collectSearchResults();
    }

    const sorted = Array.from(collected.values()).sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      if (b.stars !== a.stars) {
        return b.stars - a.stars;
      }
      const aScore = a.score ?? 0;
      const bScore = b.score ?? 0;
      if (bScore !== aScore) {
        return bScore - aScore;
      }
      return a.summary.fullName.localeCompare(b.summary.fullName);
    });

    return sorted.slice(offset, offset + limit).map((entry) => entry.summary);
  }

  /** Returns directory entries; client-side limit/offset due to API limitations */
  async function listPath(
    repo: RepoTarget,
    rawPath: string,
    options: ListOptions = {}
  ): Promise<ListResult> {
    const path = rawPath === "." ? "" : rawPath;
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
        repo.repo
      )}/contents/${encodeContentPath(path)}`
    );
    if (options.ref) {
      url.searchParams.set("ref", options.ref);
    }
    const response = await ghFetch(url.toString());
    const data = (await response.json()) as GitHubContentEntry | GitHubContentEntry[];
    const mappedEntries = Array.isArray(data)
      ? data.map((item) => formatEntry(item))
      : [formatEntry(data)];
    const offset = normalizeOffset(options.offset);
    const limit =
      typeof options.limit === "number"
        ? normalizeLimit(options.limit, 1, 1000)
        : undefined;
    const entries =
      limit !== undefined
        ? mappedEntries.slice(offset, offset + limit)
        : offset > 0
        ? mappedEntries.slice(offset)
        : mappedEntries;
    return {
      path: rawPath,
      ref: options.ref,
      entries,
    };
  }

  /** Decodes file content and adds stable line numbers */
  async function readFile(
    repo: RepoTarget,
    filePath: string,
    options: ReadOptions = {}
  ): Promise<ReadResult> {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
        repo.repo
      )}/contents/${encodeContentPath(filePath)}`
    );
    if (options.ref) {
      url.searchParams.set("ref", options.ref);
    }
    const response = await ghFetch(url.toString());
    const data = (await response.json()) as GitHubContentEntry;
    if (!data.content || data.type !== "file") {
      throw new ViewerError(`Path "${filePath}" is not a file or has no readable content.`);
    }
    const encoding = (data.encoding ?? "base64") as BufferEncoding;
    const buffer = Buffer.from(data.content, encoding);
    if (!options.range && buffer.length > 204800) {
      throw new ViewerError(
        `File is ${buffer.length} bytes; use --read ${filePath}@start-end to limit output.`
      );
    }
    const text = buffer.toString("utf8");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const selected = options.range ? extractRange(lines, options.range) : lines;
    const lineOffset = options.range ? options.range.start : 1;
    const outputLines = options.includeLineNumbers
      ? addLineNumbers(selected, lineOffset)
      : [...selected];
    return {
      path: filePath,
      ref: options.ref,
      range: options.range,
      lines: outputLines,
    };
  }

  async function globFiles(
    repo: RepoTarget,
    pattern: string,
    options: GlobOptions = {}
  ): Promise<GlobResult> {
    const ref = options.ref ?? (await getDefaultBranch(repo));
    const cacheKey = `${repo.owner}/${repo.repo}@${ref}:${pattern}`;
    if (!treeCache.has(cacheKey)) {
      const tree = await fetchTree(repo, ref);
      const matches: string[] = [];
      for (const entry of tree.tree ?? []) {
        if (entry.type === "blob" && minimatch(entry.path, pattern, { dot: true })) {
          matches.push(entry.path);
        }
      }
      treeCache.set(cacheKey, {
        matches,
        truncated: Boolean(tree.truncated),
      });
    }
    const cached = treeCache.get(cacheKey);
    if (!cached) {
      throw new ViewerError("Failed to cache glob results.");
    }
    return {
      pattern,
      ref,
      matches: [...cached.matches],
      truncated: cached.truncated,
    };
  }

  /**
   * Hydrates blob contents to rebuild full multi-line snippets
 */
  async function searchCode(
    repo: RepoTarget,
    options: CodeSearchOptions
  ): Promise<CodeSearchResultItem[]> {
    const limit = normalizeLimit(options.limit, 30, 100);
    const offset = normalizeOffset(options.offset);
    const toCollect = offset + limit;
    const queryParts: string[] = [];
    const trimmedPattern = options.pattern.trim();
    if (trimmedPattern.length === 0) {
      throw new ViewerError("Code search requires a non-empty pattern.");
    }
    queryParts.push(trimmedPattern);
    const repoQualifier = `repo:${repo.owner}/${repo.repo}`;
    if (!trimmedPattern.includes(repoQualifier)) {
      queryParts.push(repoQualifier);
    }
    if (options.path) {
      queryParts.push(`path:${options.path}`);
    }
    const query = queryParts.join(" ");
    const collected: GitHubCodeSearchItem[] = [];
    let page = 1;
    while (collected.length < toCollect) {
      const perPage = Math.min(100, toCollect - collected.length);
      const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
        query
      )}&per_page=${perPage}&page=${page}`;
      const response = await ghFetch(searchUrl, {
        headers: { Accept: "application/vnd.github.text-match+json" },
      });
      const body = (await response.json()) as GitHubCodeSearchResponse;
      const items = body.items ?? [];
      if (items.length === 0) {
        break;
      }
      collected.push(...items);
      if (items.length < perPage) {
        break;
      }
      page += 1;
    }

    if (collected.length === 0) {
      return [];
    }

    const fileCache = new Map<string, string[]>();
    const results = collected.slice(offset, offset + limit).map((item) => ({
      item,
      snippets: [] as CodeSearchSnippet[],
    }));

    const prepared: CodeSearchResultItem[] = [];
    for (const entry of results) {
      const item = entry.item;
      const repositoryFullName = item.repository.full_name;
      const [owner, name] = repositoryFullName.split("/");
      const targetRepo: RepoTarget = {
        owner: owner ?? repo.owner,
        repo: name ?? repo.repo,
      };
      const cacheKey = `${targetRepo.owner}/${targetRepo.repo}:${item.sha}`;
      if (!fileCache.has(cacheKey)) {
        try {
          const fileLines = await loadBlobLines(targetRepo, item.sha);
          fileCache.set(cacheKey, fileLines);
        } catch (error) {
          if (error instanceof ViewerError) {
            fileCache.set(cacheKey, []);
          } else {
            throw error;
          }
        }
      }
      const fileLines = fileCache.get(cacheKey) ?? [];
      const matchLines = collectMatchLineIndices(item.text_matches ?? [], fileLines);
      const snippets = createSnippetsFromLines(fileLines, matchLines, options.context);
      prepared.push({
        repository: {
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          fullName: repositoryFullName,
        },
        path: item.path,
        ref: item.sha,
        language: undefined,
        score: item.score,
        snippets,
        htmlUrl: item.html_url,
      });
    }

    return prepared;
  }

  /**
   * Wraps commit search API with GitHub qualifiers and normalized stats
 */
  async function searchCommits(
    repo: RepoTarget,
    options: CommitSearchOptions = {}
  ): Promise<CommitSearchResultItem[]> {
    const limit = normalizeLimit(options.limit, 50, 100);
    const offset = normalizeOffset(options.offset);
    const toCollect = offset + limit;
    const queryParts: string[] = [`repo:${repo.owner}/${repo.repo}`];
    if (options.query) {
      queryParts.push(options.query);
    }
    if (options.author) {
      queryParts.push(`author:${options.author}`);
    }
    if (options.path) {
      queryParts.push(`path:${options.path}`);
    }
    if (options.since) {
      queryParts.push(`committer-date:>=${options.since}`);
    }
    if (options.until) {
      queryParts.push(`committer-date:<=${options.until}`);
    }
    const query = queryParts.join(" ");
    const collected: GitHubCommitSearchItem[] = [];
    let page = 1;
    while (collected.length < toCollect) {
      const perPage = Math.min(100, toCollect - collected.length);
      const searchUrl = `https://api.github.com/search/commits?q=${encodeURIComponent(
        query
      )}&per_page=${perPage}&page=${page}&sort=committer-date&order=desc`;
      const response = await ghFetch(searchUrl, {
        headers: { Accept: "application/vnd.github.cloak-preview+json" },
      });
      const body = (await response.json()) as GitHubCommitSearchResponse;
      const items = body.items ?? [];
      if (items.length === 0) {
        break;
      }
      collected.push(...items);
      if (items.length < perPage) {
        break;
      }
      page += 1;
    }
    const slice = collected.slice(offset, offset + limit);
    return slice.map((item) => ({
      sha: item.sha,
      message: item.commit.message ?? "",
      authorName: item.commit.author?.name ?? item.author?.login ?? null,
      authorEmail: item.commit.author?.email ?? null,
      date: item.commit.author?.date,
      htmlUrl: item.html_url,
      stats: item.stats,
    }));
  }

  /** Calls compare endpoint; optionally includes unified patches */
  async function compareCommits(
    repo: RepoTarget,
    base: string,
    head: string,
    options: CompareOptions = {}
  ): Promise<CompareCommitsResult> {
    if (!base) {
      throw new ViewerError("Base reference is required for compareCommits.");
    }
    if (!head) {
      throw new ViewerError("Head reference is required for compareCommits.");
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
      repo.repo
    )}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const response = await ghFetch(url);
    const data = (await response.json()) as GitHubCompareResponse;
    const files = (data.files ?? []).map<CompareFileChange>((file) => ({
      sha: file.sha,
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: options.includePatches ? file.patch : undefined,
      previousFilename: file.previous_filename,
    }));
    return {
      base,
      head,
      aheadBy: data.ahead_by ?? 0,
      behindBy: data.behind_by ?? 0,
      totalCommits: data.total_commits ?? (data.commits?.length ?? 0),
      files,
    };
  }

  async function loadBlobLines(repo: RepoTarget, sha: string): Promise<string[]> {
    const cacheKey = `${repo.owner}/${repo.repo}:${sha}`;
    const cached = blobCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
      repo.repo
    )}/git/blobs/${encodeURIComponent(sha)}`;
    const response = await ghFetch(url);
    const data = (await response.json()) as GitHubBlobResponse;
    if (!data.content) {
      throw new ViewerError(`Unable to load blob content for ${repo.owner}/${repo.repo}@${sha}.`);
    }
    const encoding = (data.encoding ?? "base64") as BufferEncoding;
    const buffer = Buffer.from(data.content, encoding);
    const lines = buffer
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .split("\n");
    blobCache.set(cacheKey, lines);
    return lines;
  }

  function collectMatchLineIndices(
    matches: GitHubTextMatch[],
    fileLines: string[]
  ): number[] {
    const indices = new Set<number>();
    for (const match of matches) {
      for (const fragmentMatch of match.matches ?? []) {
        if (fragmentMatch.text) {
          const hits = findLineIndicesInFile(fileLines, fragmentMatch.text);
          for (const index of hits) {
            indices.add(index);
          }
        }
      }
      if (match.fragment) {
        const fragmentLines = stripHighlights(match.fragment)
          .replace(/\u2026/g, " ")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        for (const fragmentLine of fragmentLines) {
          const hits = findLineIndicesInFile(fileLines, fragmentLine);
          for (const index of hits) {
            indices.add(index);
          }
        }
      }
    }
    return Array.from(indices).sort((a, b) => a - b);
  }

  function createSnippetsFromLines(
    fileLines: string[],
    indices: number[],
    context: number = 2
  ): CodeSearchSnippet[] {
    if (indices.length === 0) {
      return [];
    }
    const snippets: CodeSearchSnippet[] = [];
    for (const index of indices) {
      const start = Math.max(0, index - context);
      const endExclusive = Math.min(fileLines.length, index + context + 1);
      snippets.push({
        startLine: start + 1,
        endLine: Math.max(start + 1, endExclusive),
        lines: fileLines.slice(start, endExclusive),
      });
    }
    return snippets;
  }

  function addLineNumbers(lines: string[], start: number): string[] {
    return lines.map((line, index) => {
      const lineNumber = start + index;
      return `${lineNumber.toString().padStart(6, " ")} ${line}`;
    });
  }

  async function fetchTree(repo: RepoTarget, ref: string): Promise<GitHubTreeResponse> {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
        repo.repo
      )}/git/trees/${encodeURIComponent(ref)}`
    );
    url.searchParams.set("recursive", "1");
    const response = await ghFetch(url.toString());
    const data = (await response.json()) as GitHubTreeResponse;
    if (!data.tree) {
      throw new ViewerError(`No tree data returned for ref "${ref}".`);
    }
    return data;
  }

  async function getDefaultBranch(repo: RepoTarget): Promise<string> {
    const key = `${repo.owner}/${repo.repo}`;
    const cached = repoDefaults.get(key);
    if (cached) {
      return cached;
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
      repo.repo
    )}`;
    const response = await ghFetch(url);
    const data = (await response.json()) as { default_branch?: string };
    if (!data.default_branch) {
      throw new ViewerError(`Unable to determine default branch for ${repo.owner}/${repo.repo}.`);
    }
    repoDefaults.set(key, data.default_branch);
    return data.default_branch;
  }

  return {
    listRepositories,
    searchRepositories,
    listPath,
    readFile,
    globFiles,
    searchCode,
    searchCommits,
    compareCommits,
  };
}

export function parseRepo(slug: string): RepoTarget {
  const parts = slug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ViewerError(`Invalid repo slug "${slug}". Use owner/name.`);
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

export function scopeLabel(scope: Scope): string {
  return scope.type === "org" ? `org:${scope.value}` : `user:${scope.value}`;
}

function normalizeLimit(limit: number | undefined, fallback: number, max: number): number {
  if (typeof limit !== "number" || Number.isNaN(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

function normalizeOffset(offset: number | undefined): number {
  if (typeof offset !== "number" || Number.isNaN(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function matchesPattern(value: string, pattern: string): boolean {
  const terms = pattern
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) {
    return true;
  }
  const haystack = value.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function mapRepoSummary(repo: GitHubRepoSummary): RepositorySummary | null {
  const fullName = repo.full_name ?? "";
  if (!fullName) {
    return null;
  }
  const name = repo.name ?? fullName;
  return {
    name,
    fullName,
    description: repo.description ?? null,
    language: repo.language ?? null,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    private: Boolean(repo.private),
    htmlUrl: repo.html_url ?? `https://github.com/${fullName}`,
    defaultBranch: repo.default_branch ?? "main",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    visibility: repo.visibility,
  };
}

function stripHighlights(value: string): string {
  return value.replace(/<\/?em>/g, "");
}

function findLineIndicesInFile(fileLines: string[], needle: string): number[] {
  const trimmed = needle.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const lowerNeedle = trimmed.toLowerCase();
  const indices: number[] = [];
  for (let index = 0; index < fileLines.length; index += 1) {
    const line = fileLines[index];
    if (line?.toLowerCase().includes(lowerNeedle)) {
      indices.push(index);
      break;
    }
  }
  return indices;
}

function formatEntry(entry: GitHubContentEntry): DirectoryEntry {
  if (entry.type === "file") {
    return {
      name: entry.name ?? "",
      type: "file",
      size: entry.size,
      sha: entry.sha,
    };
  }
  if (entry.type === "dir") {
    return {
      name: entry.name ?? "",
      type: "dir",
      sha: entry.sha,
    };
  }
  if (entry.type === "symlink") {
    return {
      name: entry.name ?? "",
      type: "symlink",
      target: entry.target,
      sha: entry.sha,
    };
  }
  if (entry.type === "submodule") {
    return {
      name: entry.name ?? "",
      type: "submodule",
      sha: entry.sha,
    };
  }
  return {
    name: entry.name ?? "",
    type: "other",
    sha: entry.sha,
  };
}

function extractRange(lines: string[], range: ReadRange): string[] {
  const slice: string[] = [];
  for (let lineNumber = range.start; lineNumber <= range.end; lineNumber += 1) {
    const index = lineNumber - 1;
    if (index >= lines.length) {
      break;
    }
    slice.push(lines[index] ?? "");
  }
  return slice;
}

function encodeContentPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    if (body && typeof (body as { message?: unknown }).message === "string") {
      return (body as { message: string }).message;
    }
    return JSON.stringify(body);
  } catch {
    return await response.text();
  }
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1] ?? null;
    }
  }
  return null;
}
