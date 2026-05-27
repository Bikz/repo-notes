import { readFile } from "node:fs/promises";
import type { DocSearchPayload, DocSearchResult, NoteSummary, WorkspaceIndex } from "../shared/types";
import { assertNoSymlinkInWorkspacePath, resolveWorkspaceFilePath } from "./safety";

interface SearchOptions {
  repoName?: string;
  query: string;
  maxReturnedResults?: number;
  maxConcurrency?: number;
}

interface RankedSearchResult extends DocSearchResult {
  score: number;
}

const defaultMaxReturnedResults = 250;
const maxSnippetLength = 180;

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
  const content = await readSearchableContent(rootPath, note);
  if (content === null) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const normalizedLine = line.toLowerCase();
    const matchIndex = normalizedLine.indexOf(query);
    if (matchIndex >= 0) {
      return {
        line: index + 1,
        score: index === 0 ? 80 : 55,
        snippet: snippetForLine(line, matchIndex, query.length),
      };
    }
  }

  return null;
}

async function readSearchableContent(rootPath: string, note: NoteSummary) {
  try {
    await assertNoSymlinkInWorkspacePath(rootPath, note.rootRelativePath);
    return await readFile(resolveWorkspaceFilePath(rootPath, note.rootRelativePath), "utf8");
  } catch (error) {
    if (isSkippedSearchRead(error)) {
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
