import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { NoteSummary, WorkspaceIndex } from "../shared/types";
import {
  assertSupportedNoteExtension,
  noteKindForExtension,
  resolveWorkspaceRoot,
  shouldSkipDirectory,
  shouldSkipWorkspaceChildDirectory,
  toRepoRelativePath,
  toRootRelativePath,
} from "./safety";

const defaultMaxFileBytes = 2 * 1024 * 1024;

interface ScanOptions {
  maxFileBytes?: number;
  maxConcurrency?: number;
}

export async function scanWorkspace(rootPath: string, options: ScanOptions = {}): Promise<WorkspaceIndex> {
  const root = resolveWorkspaceRoot(rootPath);
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const limit = createLimiter(options.maxConcurrency ?? 64);
  const entries = await limit(() => readdir(root, { withFileTypes: true }));
  const repoResults = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !shouldSkipWorkspaceChildDirectory(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const repoPath = resolve(root, entry.name);
        const [repoNotes, isGitRepo] = await Promise.all([
          scanRepository(root, repoPath, entry.name, maxFileBytes, limit),
          pathExists(join(repoPath, ".git"), limit),
        ]);

        return {
          repo: {
            name: entry.name,
            rootRelativePath: entry.name,
            isGitRepo,
            noteCount: repoNotes.length,
          },
          notes: repoNotes,
        };
      }),
  );
  const repos = repoResults.map((result) => result.repo);
  const notes = repoResults.flatMap((result) => result.notes);

  return {
    rootPath: root,
    scannedAtMs: Date.now(),
    repos,
    notes: notes.sort(compareNotePaths),
  };
}

async function scanRepository(
  rootPath: string,
  repoPath: string,
  repoName: string,
  maxFileBytes: number,
  limit: Limiter,
) {
  const notes: NoteSummary[] = [];
  await walkRepository(rootPath, repoPath, repoName, repoPath, maxFileBytes, notes, limit);
  return notes;
}

async function walkRepository(
  rootPath: string,
  repoPath: string,
  repoName: string,
  currentPath: string,
  maxFileBytes: number,
  notes: NoteSummary[],
  limit: Limiter,
) {
  const entries = await limit(() => readdir(currentPath, { withFileTypes: true }));

  await Promise.all(
    entries.sort((left, right) => left.name.localeCompare(right.name)).map(async (entry) => {
      const absolutePath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          await walkRepository(rootPath, repoPath, repoName, absolutePath, maxFileBytes, notes, limit);
        }
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const extension = extname(entry.name).toLowerCase();
      if (!isSupportedExtension(extension)) {
        return;
      }

      const fileStat = await limit(() => stat(absolutePath));
      if (fileStat.size > maxFileBytes) {
        return;
      }

      const noteExtension = assertSupportedNoteExtension(entry.name);
      const repoRelativePath = toRepoRelativePath(repoPath, absolutePath);
      const rootRelativePath = toRootRelativePath(rootPath, absolutePath);

      notes.push({
        id: noteId(rootRelativePath),
        repoName,
        repoRelativePath,
        rootRelativePath,
        extension: noteExtension,
        kind: noteKindForExtension(noteExtension),
        title: titleFromPath(entry.name),
        byteSize: fileStat.size,
        updatedAtMs: fileStat.mtimeMs,
      });
    }),
  );
}

function isSupportedExtension(extension: string) {
  try {
    assertSupportedNoteExtension(`file${extension}`);
    return true;
  } catch {
    return false;
  }
}

function titleFromPath(filePath: string) {
  const extension = extname(filePath);
  return basename(filePath, extension).replaceAll(/[-_]+/g, " ");
}

function noteId(rootRelativePath: string) {
  return Buffer.from(rootRelativePath).toString("base64url");
}

async function pathExists(path: string, limit: Limiter) {
  try {
    await limit(() => stat(path));
    return true;
  } catch {
    return false;
  }
}

function compareNotePaths(left: NoteSummary, right: NoteSummary) {
  if (left.repoName !== right.repoName) {
    return left.repoName.localeCompare(right.repoName);
  }

  const leftDepth = left.repoRelativePath.split("/").length;
  const rightDepth = right.repoRelativePath.split("/").length;

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return left.repoRelativePath.localeCompare(right.repoRelativePath);
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
