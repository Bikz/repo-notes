import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { CreateNoteRequest, NoteFilePayload, NoteSummary, UpdateNoteRequest } from "../shared/types";
import {
  assertAllowedNotePath,
  assertNoSymlinkInWorkspacePath,
  assertSupportedNoteExtension,
  noteKindForExtension,
  resolveWorkspaceFilePath,
  resolveWorkspaceRoot,
  shouldSkipWorkspaceChildDirectory,
  toRootRelativePath,
} from "./safety";

export async function readNoteFile(rootPath: string, rootRelativePath: string): Promise<NoteFilePayload> {
  const absolutePath = resolveWorkspaceFilePath(rootPath, rootRelativePath);
  assertSupportedNoteExtension(rootRelativePath);
  assertAllowedNotePath(rootRelativePath);
  await assertNoSymlinkInWorkspacePath(rootPath, rootRelativePath);

  const [content, fileStat] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)]);
  if (!fileStat.isFile()) {
    throw new Error("Requested note path is not a file.");
  }

  return {
    note: noteFromStat(rootRelativePath, fileStat),
    content,
  };
}

export async function writeNoteFile(
  rootPath: string,
  request: UpdateNoteRequest,
): Promise<NoteFilePayload> {
  const absolutePath = resolveWorkspaceFilePath(rootPath, request.rootRelativePath);
  assertSupportedNoteExtension(request.rootRelativePath);
  assertAllowedNotePath(request.rootRelativePath);
  await assertNoSymlinkInWorkspacePath(rootPath, request.rootRelativePath);

  const before = await stat(absolutePath);
  if (!before.isFile()) {
    throw new Error("Requested note path is not a file.");
  }

  if (!sameTimestamp(before.mtimeMs, request.expectedUpdatedAtMs)) {
    throw new NoteWriteConflictError();
  }

  await writeFile(absolutePath, request.content, "utf8");
  return readNoteFile(rootPath, request.rootRelativePath);
}

export async function createNoteFile(
  rootPath: string,
  request: CreateNoteRequest,
): Promise<NoteFilePayload> {
  assertSafeRepoName(request.repoName);
  const normalizedRepoRelativePath = request.repoRelativePath.replaceAll("\\", "/");
  assertSupportedNoteExtension(normalizedRepoRelativePath);

  const root = resolveWorkspaceRoot(rootPath);
  const repoPath = resolveWorkspaceFilePath(root, request.repoName);
  const repoStat = await stat(repoPath);
  if (!repoStat.isDirectory()) {
    throw new Error("Selected repository is not a directory.");
  }

  const absolutePath = resolveRepoFilePath(repoPath, normalizedRepoRelativePath);
  assertAllowedNotePath(normalizedRepoRelativePath);
  const rootRelativePath = toRootRelativePath(root, absolutePath);
  await assertNoSymlinkInWorkspacePath(root, rootRelativePath, { allowMissing: true });

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, request.content, { encoding: "utf8", flag: "wx" }).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("A note already exists at that path.");
    }
    throw error;
  });

  return readNoteFile(root, rootRelativePath);
}

function noteFromStat(rootRelativePath: string, fileStat: Awaited<ReturnType<typeof stat>>): NoteSummary {
  const pathParts = rootRelativePath.split("/");
  const repoName = pathParts[0] ?? "";
  const repoRelativePath = pathParts.slice(1).join("/");
  const extension = assertSupportedNoteExtension(rootRelativePath);

  return {
    id: Buffer.from(rootRelativePath).toString("base64url"),
    repoName,
    repoRelativePath,
    rootRelativePath,
    extension,
    kind: noteKindForExtension(extension),
    title: basename(rootRelativePath, extname(rootRelativePath)).replaceAll(/[-_]+/g, " "),
    byteSize: Number(fileStat.size),
    updatedAtMs: Number(fileStat.mtimeMs),
  };
}

function assertSafeRepoName(repoName: string) {
  if (
    !repoName ||
    repoName.includes("/") ||
    repoName.includes("\\") ||
    repoName === "." ||
    repoName === ".." ||
    shouldSkipWorkspaceChildDirectory(repoName)
  ) {
    throw new Error("Repository name must be a direct child of the workspace root.");
  }
}

function resolveRepoFilePath(repoPath: string, repoRelativePath: string) {
  try {
    return resolveWorkspaceFilePath(repoPath, repoRelativePath);
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside the workspace root")) {
      throw new Error("New note path must stay inside the selected repository.", { cause: error });
    }

    throw error;
  }
}

function sameTimestamp(actual: number, expected: number) {
  return Number.isFinite(expected) && Math.abs(actual - expected) <= 1;
}

export class NoteWriteConflictError extends Error {
  constructor() {
    super("This note changed on disk. Refresh the note before saving again.");
  }
}
