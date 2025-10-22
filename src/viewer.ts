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
}

export interface ListResult {
  path: string;
  ref?: string;
  entries: string[];
}

export interface ReadRange {
  start: number;
  end: number;
}

export interface ReadOptions {
  ref?: string;
  range?: ReadRange;
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

export interface ViewerOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export interface Viewer {
  listRepositories(scope: Scope): Promise<string[]>;
  listPath(repo: RepoTarget, path: string, options?: ListOptions): Promise<ListResult>;
  readFile(repo: RepoTarget, path: string, options?: ReadOptions): Promise<ReadResult>;
  globFiles(repo: RepoTarget, pattern: string, options?: GlobOptions): Promise<GlobResult>;
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
  full_name?: string;
  name?: string;
}

interface GitHubContentEntry {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  target?: string;
  content?: string;
  encoding?: string;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[];
  truncated?: boolean;
}

export function createViewer(options: ViewerOptions = {}): Viewer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authToken = options.token ?? process.env.GITHUB_TOKEN ?? null;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const treeCache = new Map<string, TreeCacheEntry>();
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
    const entries = Array.isArray(data)
      ? data.map((item) => formatEntry(item))
      : [formatEntry(data)];
    return {
      path: rawPath,
      ref: options.ref,
      entries,
    };
  }

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
    return {
      path: filePath,
      ref: options.ref,
      range: options.range,
      lines: selected,
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
    listPath,
    readFile,
    globFiles,
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

function formatEntry(entry: GitHubContentEntry): string {
  if (entry.type === "file") {
    const size = typeof entry.size === "number" ? ` ${entry.size}B` : "";
    return `- ${entry.name ?? ""}${size}`;
  }
  if (entry.type === "dir") {
    return `d ${entry.name ?? ""}/`;
  }
  if (entry.type === "symlink") {
    const target = entry.target ? ` -> ${entry.target}` : "";
    return `l ${entry.name ?? ""}${target}`.trim();
  }
  return `${entry.type ?? "?"} ${entry.name ?? ""}`.trim();
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
