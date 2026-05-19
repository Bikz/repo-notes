import { homedir } from "node:os";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { NoteKind, SupportedNoteExtension } from "../shared/types";

export const supportedNoteExtensions = new Set<SupportedNoteExtension>([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".html",
  ".htm",
]);

export function resolveWorkspaceRoot(rootPath: string) {
  const expanded = rootPath.startsWith("~/") ? join(homedir(), rootPath.slice(2)) : rootPath;

  if (!isAbsolute(expanded)) {
    throw new Error("Workspace root must be an absolute path.");
  }

  return resolve(expanded);
}

export function resolveWorkspaceFilePath(rootPath: string, rootRelativePath: string) {
  const root = resolveWorkspaceRoot(rootPath);

  if (isAbsolute(rootRelativePath)) {
    throw new Error("Workspace file paths must be relative to the workspace root.");
  }

  const target = resolve(root, normalize(rootRelativePath));
  const targetRelativeToRoot = relative(root, target);

  if (
    targetRelativeToRoot === "" ||
    targetRelativeToRoot.startsWith("..") ||
    isAbsolute(targetRelativeToRoot)
  ) {
    throw new Error("Refusing to access a path outside the workspace root.");
  }

  return target;
}

export function assertSupportedNoteExtension(filePath: string): SupportedNoteExtension {
  const extension = extname(filePath).toLowerCase() as SupportedNoteExtension;

  if (!supportedNoteExtensions.has(extension)) {
    throw new Error(`Unsupported note extension: ${extension || "(none)"}`);
  }

  return extension;
}

export function noteKindForExtension(extension: SupportedNoteExtension): NoteKind {
  if (extension === ".txt") {
    return "text";
  }

  if (extension === ".html" || extension === ".htm") {
    return "html";
  }

  return "markdown";
}

export function toRootRelativePath(rootPath: string, absolutePath: string) {
  return relative(resolveWorkspaceRoot(rootPath), absolutePath).split(sep).join("/");
}

export function toRepoRelativePath(repoPath: string, absolutePath: string) {
  return relative(repoPath, absolutePath).split(sep).join("/");
}

