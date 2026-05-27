import { readFile } from "node:fs/promises";
import { posix as pathPosix } from "node:path";
import type { DocBacklink, DocBacklinksPayload, NoteSummary, WorkspaceIndex } from "../shared/types";
import { assertNoSymlinkInWorkspacePath, resolveWorkspaceFilePath } from "./safety";

interface BacklinksOptions {
  maxReturnedBacklinks?: number;
  maxConcurrency?: number;
  nowMs?: number;
}

const markdownLinkPattern = /(!?)\[[^\]]*]\(([^)]+)\)/g;
const defaultMaxReturnedBacklinks = 100;

export async function getWorkspaceBacklinks(
  rootPath: string,
  index: WorkspaceIndex,
  rootRelativePath: string,
  options: BacklinksOptions = {},
): Promise<DocBacklinksPayload> {
  const target = index.notes.find((note) => note.rootRelativePath === rootRelativePath);
  if (!target) {
    throw new Error("Backlink target is not in the current index. Refresh the workspace and try again.");
  }

  const maxReturnedBacklinks = options.maxReturnedBacklinks ?? defaultMaxReturnedBacklinks;
  const limit = createLimiter(options.maxConcurrency ?? 32);
  const candidates = index.notes.filter(
    (note) => note.repoName === target.repoName && note.rootRelativePath !== target.rootRelativePath && note.kind === "markdown",
  );
  const backlinks: DocBacklink[] = [];

  await Promise.all(
    candidates.map((note) =>
      limit(async () => {
        const content = await readIndexedNoteContent(rootPath, note).catch((error: unknown) => {
          if (isUnreadableIndexedNote(error)) {
            return null;
          }

          throw error;
        });
        if (content === null) {
          return;
        }

        for (const backlink of backlinksForNote(note, content, target)) {
          backlinks.push(backlink);
        }
      }),
    ),
  );

  const sortedBacklinks = backlinks.sort(compareBacklinks);
  return {
    generatedAtMs: options.nowMs ?? Date.now(),
    target,
    backlinkCount: sortedBacklinks.length,
    returnedBacklinkCount: Math.min(sortedBacklinks.length, maxReturnedBacklinks),
    isTruncated: sortedBacklinks.length > maxReturnedBacklinks,
    backlinks: sortedBacklinks.slice(0, maxReturnedBacklinks),
  };
}

async function readIndexedNoteContent(rootPath: string, note: NoteSummary) {
  await assertNoSymlinkInWorkspacePath(rootPath, note.rootRelativePath);
  return readFile(resolveWorkspaceFilePath(rootPath, note.rootRelativePath), "utf8");
}

function backlinksForNote(note: NoteSummary, content: string, target: NoteSummary): DocBacklink[] {
  const backlinks: DocBacklink[] = [];

  for (const match of content.matchAll(markdownLinkPattern)) {
    const isImage = match[1] === "!";
    const rawTarget = match[2];
    if (isImage || !rawTarget) {
      continue;
    }

    const linkTarget = normalizeMarkdownLinkTarget(rawTarget);
    if (!linkTarget || isExternalTarget(linkTarget)) {
      continue;
    }

    const targetPath = pathWithoutAnchorOrQuery(linkTarget);
    if (!targetPath) {
      continue;
    }

    if (resolveMarkdownLink(note, targetPath) !== target.rootRelativePath) {
      continue;
    }

    backlinks.push({
      id: `${note.rootRelativePath}:${match.index ?? 0}`,
      source: note,
      line: lineNumberAt(content, match.index ?? 0),
    });
  }

  return backlinks;
}

function normalizeMarkdownLinkTarget(rawTarget: string) {
  const trimmed = rawTarget.trim();
  const bracketed = trimmed.match(/^<([^>]+)>/);
  const firstToken = bracketed?.[1] ?? trimmed.split(/\s+/)[0] ?? "";

  try {
    return decodeURIComponent(firstToken);
  } catch {
    return firstToken;
  }
}

function isExternalTarget(target: string) {
  return target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function pathWithoutAnchorOrQuery(target: string) {
  return target.split("#")[0]?.split("?")[0]?.trim() ?? "";
}

function resolveMarkdownLink(note: NoteSummary, targetPath: string) {
  const normalizedTarget = targetPath.replaceAll("\\", "/");
  const basePath = normalizedTarget.startsWith("/")
    ? pathPosix.join(note.repoName, normalizedTarget.slice(1))
    : pathPosix.join(pathPosix.dirname(note.rootRelativePath), normalizedTarget);

  return pathPosix.normalize(basePath);
}

function lineNumberAt(content: string, offset: number) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function compareBacklinks(left: DocBacklink, right: DocBacklink) {
  return (
    left.source.repoRelativePath.localeCompare(right.source.repoRelativePath) ||
    left.line - right.line
  );
}

function isUnreadableIndexedNote(error: unknown) {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "ENOENT") || error.message.toLowerCase().includes("symlink"))
  );
}

function createLimiter(maxConcurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    activeCount += 1;
    try {
      return await task();
    } finally {
      activeCount -= 1;
      queue.shift()?.();
    }
  }

  return run;
}
