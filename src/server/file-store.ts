import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { CreateNoteRequest, NoteFilePayload, NoteSummary, UpdateNoteRequest } from "../shared/types";
import {
  assertSupportedNoteExtension,
  noteKindForExtension,
  resolveWorkspaceFilePath,
  resolveWorkspaceRoot,
} from "./safety";

export async function readNoteFile(rootPath: string, rootRelativePath: string): Promise<NoteFilePayload> {
  const absolutePath = resolveWorkspaceFilePath(rootPath, rootRelativePath);
  assertSupportedNoteExtension(rootRelativePath);

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

  const before = await stat(absolutePath);
  if (!before.isFile()) {
    throw new Error("Requested note path is not a file.");
  }

  await writeFile(absolutePath, request.content, "utf8");
  return readNoteFile(rootPath, request.rootRelativePath);
}

export async function createNoteFile(
  rootPath: string,
  request: CreateNoteRequest,
): Promise<NoteFilePayload> {
  assertSafeRepoName(request.repoName);
  assertSupportedNoteExtension(request.repoRelativePath);

  const root = resolveWorkspaceRoot(rootPath);
  const repoPath = resolveWorkspaceFilePath(root, request.repoName);
  const repoStat = await stat(repoPath);
  if (!repoStat.isDirectory()) {
    throw new Error("Selected repository is not a directory.");
  }

  const rootRelativePath = `${request.repoName}/${request.repoRelativePath.replaceAll("\\", "/")}`;
  const absolutePath = resolveWorkspaceFilePath(root, rootRelativePath);

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
  if (!repoName || repoName.includes("/") || repoName.includes("\\") || repoName === "." || repoName === "..") {
    throw new Error("Repository name must be a direct child of the workspace root.");
  }
}
