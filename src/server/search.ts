import { readFile, stat } from "node:fs/promises";
import type { DocSearchPayload, DocSearchResult, NoteSummary, WorkspaceIndex } from "../shared/types";
import { assertNoSymlinkInWorkspacePath, resolveWorkspaceFilePath, resolveWorkspaceRoot } from "./safety";

interface SearchOptions {
  repoName?: string;
  query: string;
  maxReturnedResults?: number;
  maxConcurrency?: number;
}

interface RankedSearchResult extends DocSearchResult {
  score: number;
}

interface SearchContentCacheEntry {
  byteSize: number;
  updatedAtMs: number;
  content: string;
  normalizedContent: string;
  lineStartOffsets: number[];
}

interface SearchContentCacheStats {
  entries: number;
  hits: number;
  misses: number;
  refreshes: number;
  skippedReads: number;
}

interface SearchContentWarmupResult {
  warmedNotes: number;
  skippedNotes: number;
}

interface SearchContentWarmupOptions {
  repoName?: string;
  maxConcurrency?: number;
}

const defaultMaxReturnedResults = 250;
const maxSnippetLength = 180;
const searchContentCache = new Map<string, SearchContentCacheEntry>();
const searchContentWarmups = new Map<string, Promise<SearchContentWarmupResult>>();
let searchContentCacheStats: Omit<SearchContentCacheStats, "entries"> = {
  hits: 0,
  misses: 0,
  refreshes: 0,
  skippedReads: 0,
};

export function clearSearchContentCache() {
  searchContentCache.clear();
  searchContentWarmups.clear();
  searchContentCacheStats = {
    hits: 0,
    misses: 0,
    refreshes: 0,
    skippedReads: 0,
  };
}

export function getSearchContentCacheStats(): SearchContentCacheStats {
  return {
    entries: searchContentCache.size,
    ...searchContentCacheStats,
  };
}

export function invalidateSearchContentCache(rootPath: string, rootRelativePath?: string) {
  if (rootRelativePath) {
    searchContentCache.delete(searchContentCacheKey(rootPath, rootRelativePath));
    return;
  }

  const rootPrefix = searchContentCacheRootPrefix(rootPath);
  for (const key of searchContentCache.keys()) {
    if (key.startsWith(rootPrefix)) {
      searchContentCache.delete(key);
    }
  }
}

export function queueSearchContentCacheWarmup(
  rootPath: string,
  index: WorkspaceIndex,
  options: SearchContentWarmupOptions = {},
) {
  const warmupKey = `${searchContentCacheRootPrefix(rootPath)}${index.scannedAtMs}:${options.repoName ?? "all"}`;
  if (searchContentWarmups.has(warmupKey)) {
    return;
  }

  const warmup = warmSearchContentCache(rootPath, index, options).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Failed to warm search content cache.");
    return { warmedNotes: 0, skippedNotes: 0 };
  });
  searchContentWarmups.set(warmupKey, warmup);
  void warmup.finally(() => {
    searchContentWarmups.delete(warmupKey);
  });
}

export async function warmSearchContentCache(
  rootPath: string,
  index: WorkspaceIndex,
  options: SearchContentWarmupOptions = {},
): Promise<SearchContentWarmupResult> {
  pruneSearchContentCache(rootPath, index);
  const scopedNotes = index.notes.filter((note) => !options.repoName || note.repoName === options.repoName);
  const limit = createLimiter(options.maxConcurrency ?? 32);
  const results = await Promise.all(
    scopedNotes.map((note) =>
      limit(async () => ((await readSearchableContent(rootPath, note)) === null ? "skipped" : "warmed")),
    ),
  );

  return {
    warmedNotes: results.filter((result) => result === "warmed").length,
    skippedNotes: results.filter((result) => result === "skipped").length,
  };
}

export async function searchWorkspaceDocs(
  rootPath: string,
  index: WorkspaceIndex,
  options: SearchOptions,
): Promise<DocSearchPayload> {
  const query = normalizeQuery(options.query);
  const maxReturnedResults = options.maxReturnedResults ?? defaultMaxReturnedResults;
  const scopedNotes = index.notes.filter((note) => !options.repoName || note.repoName === options.repoName);
  const limit = createLimiter(options.maxConcurrency ?? 32);

  if (!query) {
    return emptySearchPayload(options, scopedNotes.length, query);
  }

  const results = (
    await Promise.all(scopedNotes.map((note) => limit(() => searchNote(rootPath, note, query))))
  ).filter((result): result is RankedSearchResult => result !== null);
  const sortedResults = results.sort(compareRankedResults);

  return {
    generatedAtMs: Date.now(),
    query,
    scope: {
      repoName: options.repoName,
      label: options.repoName ?? "All repos",
    },
    searchedNotes: scopedNotes.length,
    resultCount: sortedResults.length,
    returnedResultCount: Math.min(sortedResults.length, maxReturnedResults),
    results: sortedResults.slice(0, maxReturnedResults).map((result) => ({
      note: result.note,
      matchKind: result.matchKind,
      line: result.line,
      snippet: result.snippet,
    })),
  };
}

async function searchNote(rootPath: string, note: NoteSummary, query: string): Promise<RankedSearchResult | null> {
  const metadataScore = scoreMetadata(note, query);
  const contentMatch = await findContentMatch(rootPath, note, query);

  if (metadataScore === 0 && !contentMatch) {
    return null;
  }

  if (metadataScore >= (contentMatch?.score ?? 0)) {
    return {
      note,
      matchKind: "metadata",
      snippet: contentMatch?.snippet,
      line: contentMatch?.line,
      score: metadataScore,
    };
  }

  if (contentMatch) {
    return {
      note,
      matchKind: "content",
      line: contentMatch.line,
      snippet: contentMatch.snippet,
      score: contentMatch.score,
    };
  }

  return null;
}

function scoreMetadata(note: NoteSummary, query: string) {
  const title = note.title.toLowerCase();
  const repoRelativePath = note.repoRelativePath.toLowerCase();
  const rootRelativePath = note.rootRelativePath.toLowerCase();
  const repoName = note.repoName.toLowerCase();

  if (title === query) {
    return 140;
  }

  if (title.includes(query)) {
    return 120;
  }

  if (repoRelativePath.includes(query)) {
    return 100;
  }

  if (rootRelativePath.includes(query)) {
    return 90;
  }

  if (repoName.includes(query)) {
    return 70;
  }

  return 0;
}

async function findContentMatch(rootPath: string, note: NoteSummary, query: string) {
  const searchableContent = await readSearchableContent(rootPath, note);
  if (searchableContent === null) {
    return null;
  }

  const matchIndex = searchableContent.normalizedContent.indexOf(query);
  if (matchIndex < 0) {
    return null;
  }

  const lineIndex = lineIndexForOffset(searchableContent.lineStartOffsets, matchIndex);
  const lineStartOffset = searchableContent.lineStartOffsets[lineIndex] ?? 0;
  const lineEndOffset = searchableContent.lineStartOffsets[lineIndex + 1] ?? searchableContent.content.length;
  const line = searchableContent.content.slice(lineStartOffset, lineEndOffset).replace(/\r?\n$/, "");

  return {
    line: lineIndex + 1,
    score: lineIndex === 0 ? 80 : 55,
    snippet: snippetForLine(line, Math.max(0, matchIndex - lineStartOffset), query.length),
  };
}

async function readSearchableContent(rootPath: string, note: NoteSummary) {
  try {
    await assertNoSymlinkInWorkspacePath(rootPath, note.rootRelativePath);
    const absolutePath = resolveWorkspaceFilePath(rootPath, note.rootRelativePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return null;
    }

    const cacheKey = searchContentCacheKey(rootPath, note.rootRelativePath);
    const cachedContent = searchContentCache.get(cacheKey);
    if (cachedContent && isCurrentCachedContent(cachedContent, fileStat)) {
      searchContentCacheStats.hits += 1;
      return cachedContent;
    }

    if (cachedContent) {
      searchContentCacheStats.refreshes += 1;
    } else {
      searchContentCacheStats.misses += 1;
    }

    const content = await readFile(absolutePath, "utf8");
    const nextContent = searchableContentFromFile(content, fileStat);
    searchContentCache.set(cacheKey, nextContent);
    return nextContent;
  } catch (error) {
    if (isSkippedSearchRead(error)) {
      searchContentCache.delete(searchContentCacheKey(rootPath, note.rootRelativePath));
      searchContentCacheStats.skippedReads += 1;
      return null;
    }

    throw error;
  }
}

function isSkippedSearchRead(error: unknown) {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "ENOENT") || error.message.toLowerCase().includes("symlink"))
  );
}

function snippetForLine(line: string, matchIndex: number, queryLength: number) {
  const trimmedLine = line.trim();
  if (trimmedLine.length <= maxSnippetLength) {
    return trimmedLine;
  }

  const start = Math.max(0, matchIndex - 64);
  const end = Math.min(line.length, matchIndex + queryLength + 96);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";

  return `${prefix}${line.slice(start, end).trim()}${suffix}`;
}

function compareRankedResults(left: RankedSearchResult, right: RankedSearchResult) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.note.updatedAtMs !== right.note.updatedAtMs) {
    return right.note.updatedAtMs - left.note.updatedAtMs;
  }

  return left.note.rootRelativePath.localeCompare(right.note.rootRelativePath);
}

function emptySearchPayload(options: SearchOptions, searchedNotes: number, query: string): DocSearchPayload {
  return {
    generatedAtMs: Date.now(),
    query,
    scope: {
      repoName: options.repoName,
      label: options.repoName ?? "All repos",
    },
    searchedNotes,
    resultCount: 0,
    returnedResultCount: 0,
    results: [],
  };
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

function pruneSearchContentCache(rootPath: string, index: WorkspaceIndex) {
  const rootPrefix = searchContentCacheRootPrefix(rootPath);
  const indexedKeys = new Set(index.notes.map((note) => searchContentCacheKey(rootPath, note.rootRelativePath)));
  for (const key of searchContentCache.keys()) {
    if (key.startsWith(rootPrefix) && !indexedKeys.has(key)) {
      searchContentCache.delete(key);
    }
  }
}

function searchContentCacheKey(rootPath: string, rootRelativePath: string) {
  return `${searchContentCacheRootPrefix(rootPath)}${rootRelativePath}`;
}

function searchContentCacheRootPrefix(rootPath: string) {
  return `${resolveWorkspaceRoot(rootPath)}\0`;
}

function isCurrentCachedContent(
  cachedContent: SearchContentCacheEntry,
  fileStat: Awaited<ReturnType<typeof stat>>,
) {
  return Number(fileStat.size) === cachedContent.byteSize && Number(fileStat.mtimeMs) === cachedContent.updatedAtMs;
}

function searchableContentFromFile(
  content: string,
  fileStat: Awaited<ReturnType<typeof stat>>,
): SearchContentCacheEntry {
  return {
    byteSize: Number(fileStat.size),
    updatedAtMs: Number(fileStat.mtimeMs),
    content,
    normalizedContent: content.toLowerCase(),
    lineStartOffsets: lineStartOffsetsForContent(content),
  };
}

function lineStartOffsetsForContent(content: string) {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n" && index + 1 < content.length) {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

function lineIndexForOffset(lineStartOffsets: number[], offset: number) {
  let low = 0;
  let high = lineStartOffsets.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleOffset = lineStartOffsets[middle] ?? 0;
    const nextOffset = lineStartOffsets[middle + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < middleOffset) {
      high = middle - 1;
    } else if (offset >= nextOffset) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return Math.max(0, lineStartOffsets.length - 1);
}

type Limiter = <T>(operation: () => Promise<T>) => Promise<T>;

function createLimiter(maxConcurrency: number): Limiter {
  let activeCount = 0;
  const waiting: Array<() => void> = [];

  function release() {
    activeCount -= 1;
    waiting.shift()?.();
  }

  return async function limit<T>(operation: () => Promise<T>) {
    if (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    activeCount += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}
