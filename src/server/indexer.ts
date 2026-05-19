import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { NoteSummary, RepoSummary, WorkspaceIndex } from "../shared/types";
import {
  assertSupportedNoteExtension,
  noteKindForExtension,
  resolveWorkspaceRoot,
  toRepoRelativePath,
  toRootRelativePath,
} from "./safety";

const ignoredDirectoryNames = new Set([
  ".git",
  ".build",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "DerivedData",
  "build",
  "coverage",
  "deps",
  "dist",
  "node_modules",
  "Pods",
  "target",
  "vendor",
]);

const defaultMaxFileBytes = 2 * 1024 * 1024;

interface ScanOptions {
  maxFileBytes?: number;
}

export async function scanWorkspace(rootPath: string, options: ScanOptions = {}): Promise<WorkspaceIndex> {
  const root = resolveWorkspaceRoot(rootPath);
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const entries = await readdir(root, { withFileTypes: true });
  const repos: RepoSummary[] = [];
  const notes: NoteSummary[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const repoPath = resolve(root, entry.name);
    const repoNotes = await scanRepository(root, repoPath, entry.name, maxFileBytes);
    const isGitRepo = await pathExists(join(repoPath, ".git"));

    repos.push({
      name: entry.name,
      rootRelativePath: entry.name,
      isGitRepo,
      noteCount: repoNotes.length,
    });
    notes.push(...repoNotes);
  }

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
) {
  const notes: NoteSummary[] = [];
  await walkRepository(rootPath, repoPath, repoName, repoPath, maxFileBytes, notes);
  return notes;
}

async function walkRepository(
  rootPath: string,
  repoPath: string,
  repoName: string,
  currentPath: string,
  maxFileBytes: number,
  notes: NoteSummary[],
) {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        await walkRepository(rootPath, repoPath, repoName, absolutePath, maxFileBytes, notes);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (!isSupportedExtension(extension)) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxFileBytes) {
      continue;
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
  }
}

function isSupportedExtension(extension: string) {
  try {
    assertSupportedNoteExtension(`file${extension}`);
    return true;
  } catch {
    return false;
  }
}

function shouldSkipDirectory(name: string) {
  if (ignoredDirectoryNames.has(name)) {
    return true;
  }

  return name.startsWith(".") && name !== ".github" && name !== ".well-known";
}

function titleFromPath(filePath: string) {
  const extension = extname(filePath);
  return basename(filePath, extension).replaceAll(/[-_]+/g, " ");
}

function noteId(rootRelativePath: string) {
  return Buffer.from(rootRelativePath).toString("base64url");
}

async function pathExists(path: string) {
  try {
    await stat(path);
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
